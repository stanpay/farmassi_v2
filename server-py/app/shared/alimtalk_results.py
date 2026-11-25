"""
알림톡 도착 결과 확인 (스케줄러가 1분마다 부른다).

발송 응답 code 0 은 '알리고가 접수했다'일 뿐이다. 손님에게 갔는지는 나중에 물어봐야 안다.

  1) 알림톡 결과조회 akv10/history/detail (mid)
     rslt '0' → 알림톡 도착. 그 밖의 rslt → 알림톡 실패, rslt_message 가 사유.
  2) 알림톡이 실패하면 알리고가 대체문자를 보내고 smid 를 준다.
     알림톡 결과조회는 문자 결과를 알려주지 않으므로 문자 API apis.aligo.in/sms_list/ 에
     smid 를 넣어 본다. sms_state '발송완료' → 문자 도착, 그 밖(대기·전송중 제외) → 실패.
  3) 둘 다 실패면 관리자에게 알린다 (메일 + 관리자 웹푸시). alerted_at 으로 한 번만.

알리고가 결과를 늦게 주는 경우가 있어 일정 시간은 기다린다. 너무 오래 결과가 없으면
'확인 시간 초과'로 실패 처리한다 — 영영 확인 중으로 남아 있으면 아무도 모른다.
"""
from __future__ import annotations

import json
import os
from typing import Any

import asyncpg
import httpx

DETAIL_URL = "https://kakaoapi.aligo.in/akv10/history/detail/"
SMS_LIST_URL = "https://apis.aligo.in/sms_list/"

#: 이 시간 안에 결과가 안 오면 실패로 본다.
GIVE_UP_MINUTES = 60
#: 알림톡이 실패했는데 smid 가 이 시간 안에 안 붙으면 대체문자가 없는 것으로 본다.
SMID_WAIT_MINUTES = 10
SMS_PENDING = {"", "대기", "전송중", "발송중", "결과대기"}
SMS_DONE = {"발송완료", "성공", "수신완료"}


async def _detail(mid: str) -> dict[str, Any] | None:
    data = {"apikey": os.environ.get("ALIGO_API_KEY", "").strip(),
            "userid": os.environ.get("ALIGO_USER_ID", "").strip(), "mid": mid}
    async with httpx.AsyncClient(timeout=15) as client:
        body = (await client.post(DETAIL_URL, data=data)).json()
    items = body.get("list") or []
    item = items[0] if items else None
    if item:
        item.pop("senderKey", None)
    return item


async def _sms(smid: str) -> dict[str, Any] | None:
    data = {"key": os.environ.get("ALIGO_API_KEY", "").strip(),
            "user_id": os.environ.get("ALIGO_USER_ID", "").strip(), "mid": smid}
    async with httpx.AsyncClient(timeout=15) as client:
        body = (await client.post(SMS_LIST_URL, data=data)).json()
    items = body.get("list") or []
    return items[0] if items else None


async def check_pending(conn: asyncpg.Connection, limit: int = 50) -> dict[str, int]:
    rows = await conn.fetch(
        """select id, mid, smid, created_at,
                  extract(epoch from now() - created_at) / 60 as age_min
             from public.alimtalk_logs
            where result = 'pending' and mid is not null
            order by created_at limit $1""", limit)
    counts = {"checked": 0, "alimtalk": 0, "sms": 0, "failed": 0}
    for row in rows:
        counts["checked"] += 1
        try:
            outcome = await _check_one(dict(row))
        except Exception as error:  # noqa: BLE001
            print("알림톡 결과 확인 실패", row["mid"], error)
            await conn.execute(
                "update public.alimtalk_logs set checked_at = now(), check_count = check_count + 1"
                " where id = $1", row["id"])
            continue

        await conn.execute(
            """update public.alimtalk_logs
                  set result = $2, at_rslt = $3, at_rslt_message = $4, smid = $5,
                      sms_state = $6, fail_reason = $7,
                      checked_at = now(), check_count = check_count + 1,
                      response = coalesce(response, '{}'::jsonb) || $8::jsonb
                where id = $1""",
            row["id"], outcome["result"], outcome.get("at_rslt"), outcome.get("at_rslt_message"),
            outcome.get("smid"), outcome.get("sms_state"), outcome.get("fail_reason"),
            json.dumps({"result_check": outcome.get("raw") or {}}, ensure_ascii=False))
        if outcome["result"] in counts:
            counts[outcome["result"]] += 1

    counts["alerted"] = await alert_failures(conn)
    return counts


async def _check_one(row: dict[str, Any]) -> dict[str, Any]:
    age = float(row["age_min"] or 0)
    item = await _detail(str(row["mid"]))
    raw: dict[str, Any] = {"alimtalk": item}
    rslt = str((item or {}).get("rslt") or "").strip()

    if not rslt:
        if age > GIVE_UP_MINUTES:
            return {"result": "failed", "fail_reason": "알림톡 결과 확인 시간 초과", "raw": raw}
        return {"result": "pending", "raw": raw}

    base = {"at_rslt": rslt, "at_rslt_message": item.get("rslt_message"), "raw": raw}
    if rslt == "0":
        return {**base, "result": "alimtalk"}

    smid = str(item.get("smid") or "").strip()
    if not smid or smid == "0":
        if age > SMID_WAIT_MINUTES:
            return {**base, "result": "failed",
                    "fail_reason": f"알림톡 실패({item.get('rslt_message')}), 대체문자 없음"}
        return {**base, "result": "pending"}

    sms = await _sms(smid)
    raw["sms"] = sms
    state = str((sms or {}).get("sms_state") or "").strip()
    base |= {"smid": smid, "sms_state": state or None}
    if state in SMS_DONE:
        return {**base, "result": "sms"}
    if state in SMS_PENDING:
        if age > GIVE_UP_MINUTES:
            return {**base, "result": "failed", "fail_reason": "대체문자 결과 확인 시간 초과"}
        return {**base, "result": "pending"}
    return {**base, "result": "failed",
            "fail_reason": f"알림톡 실패({item.get('rslt_message')}), 대체문자 실패({state})"}


KIND_LABEL = {"order_done": "주문완료", "tracking": "택배번호", "delivered": "배송완료",
              "signup": "회원가입"}


async def alert_failures(conn: asyncpg.Connection) -> int:
    """실패했는데 아직 알리지 않은 건을 관리자에게 알린다."""
    rows = await conn.fetch(
        """select l.id, l.kind, l.phone, l.fail_reason, l.created_at,
                  f.name as farm_name, o.order_no
             from public.alimtalk_logs l
             left join public.farms f on f.id = l.farm_id
             left join public.orders o on o.id = l.order_id
            where l.result = 'failed' and l.alerted_at is null
            order by l.created_at limit 20""")
    if not rows:
        return 0

    from .mailer import send_admin_mail
    from .push import notify_admins

    lines = []
    for r in rows:
        where = " · ".join(x for x in (r["farm_name"], r["order_no"]) if x) or "-"
        phone = r["phone"] or ""
        masked = f"{phone[:3]}-****-{phone[-4:]}" if len(phone) >= 10 else (phone or "번호 없음")
        lines.append(f"- [{KIND_LABEL.get(r['kind'], r['kind'])}] {where} / {masked} / {r['fail_reason']}")

    title = f"알림톡·문자 발송 실패 {len(rows)}건"
    body = "\n".join(lines)
    await send_admin_mail(subject=f"[확인필요] {title}", lines=[
        "손님에게 알림톡과 대체문자가 모두 전달되지 않았습니다.", "", body, "",
        "관리자 화면 > 카카오톡 > 발송 로그 에서 사유를 확인해주세요.",
    ])
    await notify_admins(conn, title=title, body=lines[0][2:], url="/admin/kakao")
    await conn.execute(
        "update public.alimtalk_logs set alerted_at = now() where id = any($1::uuid[])",
        [r["id"] for r in rows])
    return len(rows)
