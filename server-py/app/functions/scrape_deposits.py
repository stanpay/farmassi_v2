"""
뱅크다A 에서 입금내역을 가져와 입금대기 주문에 붙인다.

크론은 x-cron-secret 헤더로, 관리자는 로그인 상태로 호출한다.
뱅크다 조회는 계좌당 5분 제한이 있으므로 크론 간격을 그보다 짧게 두지 말 것.
"""
import re
from datetime import datetime, timedelta, timezone

from ..sb import Sb, sb
from ..shared.bankda import BankdaError, fetch_transactions, to_bankda_date, to_iso_at
from ..shared.deposit_matching import match_deposit
from ..shared.mailer import send_deposit_mail
from ..shared.alimtalk import notify_order_done
from ..shared.push import notify_farm_members
from ..shared.util import is_admin, now_iso
from .types import FnCtx, FnResult, fail, ok

PROVIDER = "bankda"


async def scrape_deposits(ctx: FnCtx) -> FnResult:
    if not ctx.body.get("__byCron"):
        if not ctx.user_id:
            return fail("로그인이 필요합니다.", 401)
        if not await is_admin(ctx.admin, ctx.user_id):
            return fail("관리자만 실행할 수 있습니다.", 403)

    db = sb(ctx.admin)
    days = min(max(int(ctx.body.get("days") or 3), 1), 31)
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days - 1)

    # 뱅크다를 부르지 않아도 되는 일이라 먼저 한다.
    # 조회가 5분 제한에 걸려도 예전 입금은 계속 붙여볼 수 있어야 한다.
    rematched = await _rematch_unmatched(db, ctx.admin)

    # 뱅크다가 아직 새로 긁어간 게 없으면 거래내역을 부르지 않는다.
    # 스케줄러가 계좌의 last_scraping_at 을 보고 판단해서 이 값을 넘긴다.
    if ctx.body.get("rematchOnly"):
        return ok({"rematchOnly": True, "rematched": rematched})

    try:
        rows = await fetch_transactions(
            datefrom=to_bankda_date(since),
            dateto=to_bankda_date(now),
            accountnum=ctx.body.get("accountNumber"),
        )
    except BankdaError as error:
        return FnResult(502, {"error": str(error), "rematched": rematched})

    deposits = [r for r in rows if int(r.get("bkinput") or 0) > 0]
    if not deposits:
        return ok({"fetched": len(rows), "inserted": 0, "matched": 0,
                   "rematched": rematched, "results": []})

    farms = (await db.from_("farms").select("id, name, account_number")).data or []
    farm_by_account = {}
    for farm in farms:
        digits = re.sub(r"\D", "", str(farm.get("account_number") or ""))
        if digits:
            farm_by_account[digits] = {"id": farm["id"], "name": farm["name"]}

    results: list[dict] = []
    inserted = matched = 0

    for row in deposits:
        outcome = await process_bankda_row(ctx.admin, db, row, farm_by_account)
        if outcome.get("skip"):
            continue
        if outcome.get("inserted"):
            inserted += 1
        if outcome.get("matched"):
            matched += 1
        results.append(outcome["result"])

    return ok({"fetched": len(rows), "deposits": len(deposits), "inserted": inserted,
               "matched": matched, "rematched": rematched, "results": results})


async def process_bankda_row(admin, db: Sb, row: dict, farm_by_account: dict) -> dict:
    """뱅크다 거래 1건을 넣고 대사한다 (입금완료·농가 알림·주문완료 알림톡·입금 메일).

    돌려주는 값: {"skip": True}(이미 넣은 거래) 또는 {"inserted", "matched", "result"}.
    dev 시험 입금(dev-test)도 이 함수를 그대로 쓴다 — 뱅크다 조회만 빼고 같은 길을 탄다.
    """
    amount = int(row.get("bkinput") or 0)
    farm = farm_by_account.get(re.sub(r"\D", "", str(row.get("accountnum") or "")))
    farm_id = farm["id"] if farm else None
    depositor_name = (row.get("bkjukyo") or "").strip() or None

    existing = (await db.from_("deposit_transactions").select("id")
                .eq("provider", PROVIDER).eq("external_id", row["bkcode"])
                .maybe_single()).data
    if existing:
        return {"skip": True}

    candidates = []
    if farm_id:
        candidates = (await db.from_("orders")
                      .select("id, deposit_due_amount, deposit_code, recipient_name, depositor_name")
                      .eq("farm_id", farm_id).eq("status", "pending_deposit")).data or []

    match = match_deposit(amount, depositor_name, candidates)

    insert = await db.from_("deposit_transactions").insert({
        "farm_id": farm_id,
        "provider": PROVIDER,
        "external_id": row["bkcode"],
        "occurred_at": to_iso_at(row["bkdate"], row["bktime"]),
        "amount": amount,
        "depositor_name": depositor_name,
        "raw_payload": {"source": "bankda", "match_reason": match.reason, "row": row},
        "matched_order_id": match.order_id,
        "match_status": "matched" if match.order_id else "unmatched",
    })
    if insert.error:
        return {"result": {"bkcode": row["bkcode"], "skipped": insert.error["message"]}}

    matched_order_no = None
    if match.order_id:
        # 사람이 먼저 확인한 주문은 덮어쓰지 않는다.
        updated = (await db.from_("orders").update({
            "status": "paid",
            "deposit_confirmed_at": now_iso(),
            "deposit_provider": PROVIDER,
        }).eq("id", match.order_id).eq("status", "pending_deposit")
            .select("id, order_no, farm_id")).data or []

        order = updated[0] if updated else None
        if order:
            matched_order_no = order["order_no"]
            await notify_farm_members(
                admin, farm_id=order["farm_id"], order_id=order["id"],
                type_="deposit_confirmed", title="입금 확인됨, 출고 준비",
                body=f"{order['order_no']} 입금이 확인되었습니다. 포장을 시작해주세요.")
            await notify_order_done(admin, order["id"])

    # 새로 들어온 입금 1건마다 메일 1통.
    # 이미 넣은 거래는 위에서 걸러졌으므로 중복 발송되지 않는다.
    mailed = await send_deposit_mail(
        amount=amount, depositor_name=depositor_name,
        occurred_at=to_iso_at(row["bkdate"], row["bktime"]),
        account_number=str(row.get("accountnum") or ""),
        bank_name=str(row.get("bkname") or ""),
        matched=bool(matched_order_no), order_no=matched_order_no,
        farm_name=farm["name"] if farm else None, reason=match.reason)

    return {"inserted": True, "matched": bool(matched_order_no), "result": {
        "bkcode": row["bkcode"], "amount": amount, "depositorName": depositor_name,
        "farmId": farm_id, "mailed": mailed, "reason": match.reason,
        "matchedOrderId": match.order_id, "candidates": len(match.candidate_ids),
    }}


async def _rematch_unmatched(db: Sb, admin) -> int:
    """unmatched 로 남은 입금을 현재 입금대기 주문과 다시 맞춰본다."""
    pending = (await db.from_("deposit_transactions")
               .select("id, farm_id, amount, depositor_name")
               .eq("provider", PROVIDER).eq("match_status", "unmatched")).data or []
    if not pending:
        return 0

    count = 0
    for deposit in pending:
        if not deposit["farm_id"]:
            continue

        orders = (await db.from_("orders")
                  .select("id, deposit_due_amount, deposit_code, recipient_name, depositor_name")
                  .eq("farm_id", deposit["farm_id"]).eq("status", "pending_deposit")).data or []

        match = match_deposit(deposit["amount"], deposit["depositor_name"], orders)
        if not match.order_id:
            continue

        updated = (await db.from_("orders").update({
            "status": "paid",
            "deposit_confirmed_at": now_iso(),
            "deposit_provider": PROVIDER,
        }).eq("id", match.order_id).eq("status", "pending_deposit")
            .select("id, order_no, farm_id")).data or []

        order = updated[0] if updated else None
        if not order:
            continue

        await db.from_("deposit_transactions").update(
            {"matched_order_id": match.order_id, "match_status": "matched"}
        ).eq("id", deposit["id"])

        count += 1
        await notify_farm_members(
            admin, farm_id=order["farm_id"], order_id=order["id"],
            type_="deposit_confirmed", title="입금 확인됨, 출고 준비",
            body=f"{order['order_no']} 입금이 확인되었습니다. 포장을 시작해주세요.")
        await notify_order_done(admin, order["id"])

        farm = (await db.from_("farms").select("name, account_number, bank_name")
                .eq("id", deposit["farm_id"]).maybe_single()).data
        await send_deposit_mail(
            amount=deposit["amount"], depositor_name=deposit["depositor_name"],
            occurred_at=now_iso(),
            account_number=(farm or {}).get("account_number") or "",
            bank_name=(farm or {}).get("bank_name") or "",
            matched=True, order_no=order["order_no"],
            farm_name=(farm or {}).get("name"), reason=match.reason)
    return count
