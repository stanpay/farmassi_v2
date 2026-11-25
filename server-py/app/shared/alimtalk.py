"""
카카오 알림톡 발송 (알리고).

문구·변수·버튼은 doc/alimtalk/templates.md, templates.json 과 같아야 한다.
알리고는 등록된 템플릿과 글자 하나라도 다르면 `U`(템플릿 불일치)로 떨어뜨린다.

  - 발송 실패는 여기서 삼키고 로그만 남긴다. 입금 확정·상태 변경을 되돌리지 않는다.
  - 같은 주문·같은 종류는 한 번만 보낸다 (alimtalk_logs). 상태를 오가며 다시
    눌러도 손님이 같은 문자를 두 번 받지 않게 하려는 것이다.
  - 재시도: 연결 자체가 안 된 경우(요청이 알리고에 닿지 않음)만 다시 보낸다.
    응답을 못 받은 경우는 이미 발송됐을 수 있어 다시 보내지 않는다.
  - 알림톡이 실패하면(차단·미가입 등) 알리고가 같은 내용을 문자로 보낸다(failover).
    ALIGO_SENDER(대체문자 발신번호)가 없으면 대체문자 없이 보낸다.
  - ALIMTALK_ALLOWED_PHONES 가 있으면 그 번호로만 보낸다. 개발 서버 DB 에는
    실제 손님 번호가 있어서, 시험 중에 손님에게 나가지 않게 막는 장치다.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from typing import Any

import asyncpg
import httpx

from .delivery_estimate import KST, arrival_date, format_ymd, ship_date

SEND_URL = "https://kakaoapi.aligo.in/akv10/alimtalk/send/"

_AC = {"name": "채널 추가", "linkType": "AC"}
_DS = {"name": "배송조회", "linkType": "DS"}

#: kind → 템플릿. code 는 env 로 바꿀 수 있다(채널 재등록 시).
TEMPLATES: dict[str, dict[str, Any]] = {
    "order_done": {
        "name": "주문완료 안내",
        "env": "ALIGO_TPL_ORDER_DONE",
        "code": "UO_1351",
        "buttons": [_AC],
        "content": (
            "[#{농가명}] 주문완료 안내\n\n"
            "□ 주문번호 : #{주문번호}\n"
            "□ 상품 : #{상품명}\n"
            "□ 배송지 : #{배송지}\n"
            "□ 배송예정일 : #{배송예정일}\n"
            "□ 결제금액 : #{결제금액}원\n\n"
            "주문이 정상적으로 접수되었습니다.\n"
            "배송 준비가 시작되면 다시 안내드릴게요."
        ),
    },
    "tracking": {
        "name": "택배번호 안내",
        "env": "ALIGO_TPL_TRACKING",
        "code": "UO_1352",
        "buttons": [_AC, _DS],
        "content": (
            "#{고객명}님, #{농가명}에서 보내드린 상품이 발송되었습니다.\n\n"
            "□ 상품 : #{상품명}\n"
            "□ 택배사 : #{택배회사명}\n"
            "□ 운송장번호 : #{송장번호}"
        ),
    },
    "delivered": {
        "name": "배송완료 안내",
        "env": "ALIGO_TPL_DELIVERED",
        "code": "UO_1353",
        "buttons": [_AC],
        "content": (
            "#{고객명}님, #{농가명}에서 주문하신 #{상품명}이(가) 배송완료되었습니다.\n\n"
            "맛있게 드세요."
        ),
    },
    "signup": {
        "name": "회원가입 완료",
        "env": "ALIGO_TPL_SIGNUP",
        "code": "UO_1354",
        "buttons": [_AC],
        # 회원가입은 팜어시 채널에만 등록했다. 농가 senderkey 로 보내지 않는다.
        "farmassi_only": True,
        "content": (
            "안녕하세요, #{고객명}님!\n\n"
            "팜어시 회원가입을 환영합니다.\n"
            "산지직송 농가 상품을 편하게 주문해 보세요."
        ),
    },
}

COURIER_NAMES = {"kpost": "우체국택배", "cj": "CJ대한통운", "hanjin": "한진택배"}

_VAR = re.compile(r"#\{([^}]+)\}")


def render(content: str, variables: dict[str, Any]) -> str:
    def one(m: re.Match[str]) -> str:
        key = m.group(1)
        if key not in variables or variables[key] in (None, ""):
            raise ValueError(f"알림톡 변수 '{key}' 값이 없습니다.")
        return str(variables[key])
    return _VAR.sub(one, content)


def template_variables(kind: str) -> list[str]:
    """템플릿 본문에 나오는 변수 이름 (나오는 순서, 중복 없이)."""
    seen: list[str] = []
    for name in _VAR.findall(TEMPLATES[kind]["content"]):
        if name not in seen:
            seen.append(name)
    return seen


def extract_variables(kind: str, message: str | None) -> dict[str, str] | None:
    """보낸 본문에서 변수 값을 거꾸로 뽑는다 (재전송 미리 채우기). 템플릿과 안 맞으면 None."""
    if not message:
        return None
    content = TEMPLATES[kind]["content"]
    pattern, groups = "", {}
    for i, part in enumerate(re.split(r"(#\{[^}]+\})", content)):
        m = re.fullmatch(r"#\{([^}]+)\}", part)
        if not m:
            pattern += re.escape(part)
        elif m.group(1) in groups.values():
            pattern += f"(?P={next(g for g, n in groups.items() if n == m.group(1))})"
        else:
            groups[f"v{i}"] = m.group(1)
            pattern += f"(?P<v{i}>.+?)"
    found = re.fullmatch(pattern, message, re.S)
    if not found:
        return None
    return {name: found.group(g) for g, name in groups.items()}


MAX_VARIABLE = 200
MAX_MESSAGE = 1000  # 알리고 알림톡 본문 한도


def check_variables(kind: str, values: dict[str, Any]) -> dict[str, str]:
    """수동 발송에서 고친 변수 값을 검사한다. 템플릿 문구는 못 바꾸고 변수 값만 바꾼다.

    키는 템플릿 변수와 정확히 같아야 하고, 값은 비어 있으면 안 된다. 줄바꿈과 `#{` 는
    받지 않는다(템플릿 모양이 바뀌면 알리고가 불일치로 떨어뜨린다).
    """
    names = template_variables(kind)
    extra = set(values) - set(names)
    if extra:
        raise ValueError(f"템플릿에 없는 변수입니다: {', '.join(sorted(extra))}")
    cleaned: dict[str, str] = {}
    for name in names:
        value = str(values.get(name) if values.get(name) is not None else "").strip()
        if not value:
            raise ValueError(f"'{name}' 값을 채워 주세요.")
        if len(value) > MAX_VARIABLE:
            raise ValueError(f"'{name}' 값이 너무 깁니다 ({MAX_VARIABLE}자 이하).")
        if "\n" in value or "\r" in value or "#{" in value:
            raise ValueError(f"'{name}' 값에는 줄바꿈이나 '#{{' 를 넣을 수 없습니다.")
        cleaned[name] = value
    if len(render(TEMPLATES[kind]["content"], cleaned)) > MAX_MESSAGE:
        raise ValueError(f"보낼 내용이 {MAX_MESSAGE}자를 넘습니다.")
    return cleaned


def normalize_phone(value: str | None) -> str | None:
    digits = re.sub(r"\D", "", value or "")
    return digits if re.fullmatch(r"01\d{8,9}", digits) else None


def template_code(kind: str) -> str:
    tpl = TEMPLATES[kind]
    return (os.environ.get(tpl["env"]) or tpl["code"]).strip()


def _allowed(phone: str) -> bool:
    raw = (os.environ.get("ALIMTALK_ALLOWED_PHONES") or "").strip()
    if not raw:
        return True
    return phone in {normalize_phone(p) for p in raw.split(",")}


async def _post(data: dict[str, Any], attempts: int = 3) -> dict[str, Any]:
    last: Exception | None = None
    for i in range(attempts):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(15, connect=5)) as client:
                response = await client.post(SEND_URL, data=data)
            response.raise_for_status()
            return response.json()
        except (httpx.ConnectError, httpx.ConnectTimeout) as error:
            # 요청이 알리고에 닿지 않았으니 다시 보내도 중복 발송이 아니다.
            last = error
            await asyncio.sleep(1 + i * 2)
    raise last or RuntimeError("알리고 연결 실패")


async def _already_sent(conn: asyncpg.Connection, kind: str, order_id: str | None,
                        user_id: str | None) -> bool:
    if order_id:
        row = await conn.fetchval(
            "select 1 from public.alimtalk_logs where kind = $1 and order_id = $2 and sent limit 1",
            kind, order_id)
    elif user_id:
        row = await conn.fetchval(
            "select 1 from public.alimtalk_logs where kind = $1 and user_id = $2 and sent limit 1",
            kind, user_id)
    else:
        return False
    return bool(row)


async def _log(conn: asyncpg.Connection, **row: Any) -> None:
    try:
        await conn.execute(
            """insert into public.alimtalk_logs
                 (kind, order_id, user_id, farm_id, phone, tpl_code, sent, mid, message, response,
                  result, fail_reason, sent_by, resend_of, order_no)
               values ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14,
                       (select order_no from public.orders where id = $2::uuid))""",
            row["kind"], row.get("order_id"), row.get("user_id"), row.get("farm_id"),
            row.get("phone"), row.get("tpl_code"), bool(row.get("sent")), row.get("mid"),
            # jsonb 는 커넥션 코덱이 직렬화한다(db.py). 여기서 json.dumps 하면 문자열로 두 번 감싸진다.
            row.get("message"), row.get("response") or {},
            # 접수조차 안 된 건 바로 실패. 접수된 건은 결과 확인(alimtalk_results)이 채운다.
            "pending" if row.get("sent") else "failed",
            None if row.get("sent") else row.get("fail_reason"),
            row.get("sent_by"), row.get("resend_of"))
    except Exception as error:  # noqa: BLE001
        print("알림톡 기록 실패", error)


async def send_alimtalk(
    conn: asyncpg.Connection,
    *,
    kind: str,
    phone: str | None,
    name: str | None,
    variables: dict[str, Any],
    sender_key: str | None = None,
    order_id: str | None = None,
    user_id: str | None = None,
    farm_id: str | None = None,
    force: bool = False,
    sent_by: str | None = None,
    resend_of: str | None = None,
) -> dict[str, Any]:
    """알림톡 1건. 예외를 올리지 않고 {'sent': bool, ...} 를 돌려준다.

    force=True 는 관리자 수동 발송·재전송: 같은 주문·종류를 이미 보냈어도 보낸다.
    """
    tpl = TEMPLATES[kind]
    code = template_code(kind)
    base = {"kind": kind, "order_id": order_id, "user_id": user_id, "farm_id": farm_id,
            "tpl_code": code, "sent_by": sent_by, "resend_of": resend_of}
    try:
        # 알리고 키를 넣기 전(운영에서 아직 켜지 않음)에는 기록도 알림도 없이 넘어간다.
        # 키 없이 실패로 기록하면 주문마다 관리자 실패 알림이 나간다.
        if not (os.environ.get("ALIGO_API_KEY") or "").strip():
            return {"sent": False, "skipped": "알림톡을 켜지 않았습니다 (ALIGO_API_KEY 없음)."}
        receiver = normalize_phone(phone)
        if not receiver:
            return {"sent": False, "skipped": "수신 번호가 없습니다."}
        if not _allowed(receiver):
            return {"sent": False, "skipped": "ALIMTALK_ALLOWED_PHONES 에 없는 번호입니다."}
        # 같은 주문·종류를 여러 경로(입금 확인 훅, 화면, 누락 확인 루프)가 동시에 보내지 않게
        # 확인→발송→기록을 한 번에 하나만. 수동 발송(force)은 일부러 다시 보내는 것이라 잠그지 않는다.
        if not force and (order_id or user_id):
            lock_key = f"alimtalk:{kind}:{order_id or user_id}"
            if conn.is_in_transaction():
                # 서버 커넥션(db.with_admin)은 트랜잭션 안이다. 발송 기록은 커밋돼야 남에게 보이므로
                # 잠금도 커밋까지 쥔다(xact lock). 먼저 풀면 다른 경로가 기록을 못 보고 또 보낸다
                # (11/25 시험에서 실제로 두 번 나갔다).
                await conn.execute("select pg_advisory_xact_lock(hashtext($1))", lock_key)
            else:
                await conn.execute("select pg_advisory_lock(hashtext($1))", lock_key)
            try:
                if await _already_sent(conn, kind, order_id, user_id):
                    return {"sent": False, "skipped": "이미 보냈습니다."}
                return await _send(conn, tpl, code, base, kind=kind, receiver=receiver, name=name,
                                   variables=variables, sender_key=sender_key)
            finally:
                if not conn.is_in_transaction():
                    await conn.execute("select pg_advisory_unlock(hashtext($1))", lock_key)
        return await _send(conn, tpl, code, base, kind=kind, receiver=receiver, name=name,
                           variables=variables, sender_key=sender_key)
    except Exception as error:  # noqa: BLE001
        print("알림톡 발송 실패", kind, code, error)
        await _log(conn, **base, phone=normalize_phone(phone), sent=False,
                   response={"error": str(error)}, fail_reason=f"발송 오류: {error}")
        return {"sent": False, "error": str(error)}


async def _send(conn: asyncpg.Connection, tpl: dict[str, Any], code: str, base: dict[str, Any], *,
                kind: str, receiver: str, name: str | None, variables: dict[str, Any],
                sender_key: str | None) -> dict[str, Any]:
    """실제 발송 + 기록. 예외는 부른 쪽(send_alimtalk)이 기록한다."""
    message = render(tpl["content"], variables)
    own_key = (os.environ.get("ALIGO_SENDER_KEY") or "").strip()
    key = own_key if tpl.get("farmassi_only") else ((sender_key or "").strip() or own_key)
    data: dict[str, Any] = {
        "apikey": (os.environ.get("ALIGO_API_KEY") or "").strip(),
        "userid": (os.environ.get("ALIGO_USER_ID") or "").strip(),
        "senderkey": key,
        "tpl_code": code,
        "receiver_1": receiver,
        "recvname_1": (name or "").strip() or "고객",
        "subject_1": tpl["name"],
        "message_1": message,
        "button_1": json.dumps({"button": tpl["buttons"]}, ensure_ascii=False),
    }
    missing = [k for k in ("apikey", "userid", "senderkey") if not data[k]]
    if missing:
        raise RuntimeError(f"알리고 설정 없음: {', '.join(missing)}")

    sender = normalize_phone(os.environ.get("ALIGO_SENDER"))
    if sender:
        data |= {"sender": sender, "failover": "Y",
                 "fsubject_1": tpl["name"], "fmessage_1": message}

    result = await _post(data)
    sent = str(result.get("code")) == "0"
    mid = (result.get("info") or {}).get("mid")
    await _log(conn, **base, phone=receiver, sent=sent, mid=str(mid) if mid else None,
               message=message, response=result,
               fail_reason=None if sent else f"발송 요청 거절: {result.get('message')}")
    if not sent:
        print("알림톡 발송 거절", kind, code, result.get("message"))
    return {"sent": sent, "mid": mid, "message": result.get("message"), "text": message}


# ---- 주문 알림 ----------------------------------------------------------------

async def _order_context(conn: asyncpg.Connection, order_id: str) -> dict[str, Any] | None:
    order = await conn.fetchrow(
        """select o.*, f.name as farm_name, f.aligo_sender_key, f.delivery_days,
                  p.display_name as customer_name, p.phone as customer_phone
             from public.orders o
             join public.farms f on f.id = o.farm_id
             left join public.profiles p on p.id = o.customer_id
            where o.id = $1""", order_id)
    if not order:
        return None
    items = await conn.fetch(
        "select product_name from public.order_items where order_id = $1 order by id", order_id)
    names = [r["product_name"] for r in items]
    product = names[0] if names else "주문 상품"
    if len(names) > 1:
        product = f"{product} 외 {len(names) - 1}건"

    o = dict(order)
    return {
        "order": o,
        "product": product,
        # 알림은 주문한 사람에게 간다. 선물로 받는 사람(recipient)은 마지막 후보다.
        "phone": o.get("sender_phone") or o.get("customer_phone") or o.get("recipient_phone"),
        "name": (o.get("sender_name") or o.get("customer_name") or o.get("depositor_name")
                 or o.get("recipient_name")),
    }


async def _estimated_arrival(conn: asyncpg.Connection, order: dict[str, Any]) -> str:
    today = datetime.now(KST).date()
    pauses = await conn.fetch(
        "select start_date, end_date from public.shipping_pauses where farm_id = $1 and end_date >= $2",
        order["farm_id"], today)
    holidays = [r["holiday_date"] for r in await conn.fetch(
        "select holiday_date from public.holidays where holiday_date >= $1", today)]
    days = order.get("delivery_days")
    if isinstance(days, str):
        days = json.loads(days)
    earliest = ship_date(days, [dict(p) for p in pauses], today, holidays)
    chosen = order.get("requested_ship_date")
    ship = chosen if chosen and earliest and chosen >= earliest else earliest
    if not ship:
        return "농가에서 따로 안내드릴게요"
    return format_ymd(arrival_date(ship, holidays))


ORDER_KINDS = ("order_done", "tracking", "delivered")


async def order_payload(conn: asyncpg.Connection, kind: str, order_id: str,
                        *, allow_missing: bool = False) -> dict[str, Any]:
    """주문 알림 1건에 들어갈 수신자·변수. 자동 발송과 수동 발송이 같은 값을 쓴다.

    allow_missing=True(수동 발송 미리 채우기)면 송장이 없어도 빈 값으로 돌려준다.
    그렇지 않으면 {'skipped': 사유} 를 돌려준다.
    """
    if kind not in ORDER_KINDS:
        return {"skipped": f"알 수 없는 종류: {kind}"}
    ctx = await _order_context(conn, order_id)
    if not ctx:
        return {"skipped": "주문을 찾을 수 없습니다."}
    order = ctx["order"]
    variables: dict[str, Any] = {
        "농가명": order["farm_name"],
        "주문번호": order["order_no"],
        "상품명": ctx["product"],
        "고객명": ctx["name"] or "고객",
    }
    if kind == "order_done":
        address = " ".join(x for x in (order["address"], order.get("address_detail")) if x)
        variables |= {
            "배송지": address,
            "배송예정일": await _estimated_arrival(conn, order),
            "결제금액": f"{int(order['deposit_due_amount'] or 0):,}",
        }
    elif kind == "tracking":
        shipment = await conn.fetchrow(
            """select provider, tracking_number from public.shipments
                where order_id = $1 and tracking_number is not null and tracking_number <> ''
                  and status <> 'cancelled'
                order by updated_at desc limit 1""", order_id)
        if not shipment and not allow_missing:
            return {"skipped": "송장번호가 없습니다."}
        variables |= {
            "택배회사명": COURIER_NAMES.get(shipment["provider"], shipment["provider"]) if shipment else "",
            "송장번호": shipment["tracking_number"] if shipment else "",
        }
    names = template_variables(kind)
    return {
        "phone": ctx["phone"],
        "name": ctx["name"],
        "variables": {k: ("" if variables.get(k) is None else str(variables[k])) for k in names},
        "sender_key": order.get("aligo_sender_key"),
        "order_id": str(order["id"]),
        "order_no": order["order_no"],
        "farm_id": str(order["farm_id"]),
        "farm_name": order["farm_name"],
        "user_id": str(order["customer_id"]) if order.get("customer_id") else None,
    }


async def signup_payload(conn: asyncpg.Connection, user_id: str) -> dict[str, Any]:
    """회원가입 알림. 번호·이름은 프로필에서 읽는다(아무 번호로나 보내지 못하게)."""
    profile = await conn.fetchrow(
        "select display_name, phone from public.profiles where id = $1", user_id)
    if not profile:
        return {"skipped": "프로필을 찾을 수 없습니다."}
    name = (profile["display_name"] or "").strip() or "고객"
    return {"phone": profile["phone"], "name": name, "variables": {"고객명": name},
            "sender_key": None, "order_id": None, "order_no": None, "farm_id": None,
            "farm_name": None, "user_id": user_id}


async def notify_order(conn: asyncpg.Connection, kind: str, order_id: str) -> dict[str, Any]:
    """주문 알림톡(order_done·tracking·delivered). 예외를 올리지 않는다."""
    try:
        payload = await order_payload(conn, kind, order_id)
        if "skipped" in payload:
            return {"sent": False, "skipped": payload["skipped"]}
        return await send_alimtalk(
            conn, kind=kind, phone=payload["phone"], name=payload["name"],
            variables=payload["variables"], sender_key=payload["sender_key"],
            order_id=payload["order_id"], user_id=payload["user_id"], farm_id=payload["farm_id"])
    except Exception as error:  # noqa: BLE001
        print("주문 알림톡 실패", kind, order_id, error)
        return {"sent": False, "error": str(error)}


async def notify_order_done(conn: asyncpg.Connection, order_id: str) -> dict[str, Any]:
    """입금 확정 직후 부른다."""
    return await notify_order(conn, "order_done", order_id)


#: 입금완료가 된 뒤 이 시간 안에 주문완료 알림톡 기록이 없으면 서버가 보낸다.
#: 더 오래된 주문에 뒤늦게 '주문 접수' 안내가 가지 않게 짧게 둔다.
ORDER_DONE_CATCHUP_HOURS = 2


async def send_missing_order_done(conn: asyncpg.Connection) -> int:
    """입금완료(orders.paid_at)인데 주문완료 알림톡 기록이 없는 주문에 보낸다.

    입금 확인 훅·화면 상태 변경이 각각 바로 보내지만, 화면이 닫히거나 DB 를 직접 고친 경우를
    여기서 잡는다. 기록이 하나라도 있으면(성공·실패 무관) 다시 보내지 않는다 — 실패는 관리자가
    로그에서 재전송한다. 이미 보낸 주문은 send_alimtalk 의 확인이 한 번 더 막는다.
    """
    rows = await conn.fetch(
        f"""select o.id from public.orders o
             where o.status = 'paid'
               and o.paid_at > now() - interval '{ORDER_DONE_CATCHUP_HOURS} hours'
               and not exists (select 1 from public.alimtalk_logs l
                                where l.order_id = o.id and l.kind = 'order_done')
             order by o.paid_at limit 50""")
    sent = 0
    for row in rows:
        result = await notify_order(conn, "order_done", str(row["id"]))
        sent += 1 if result.get("sent") else 0
    return sent


async def notify_signup(conn: asyncpg.Connection, user_id: str) -> dict[str, Any]:
    """회원가입 알림. 번호·이름은 프로필에서 읽는다(아무 번호로나 보내지 못하게)."""
    try:
        payload = await signup_payload(conn, user_id)
        if "skipped" in payload:
            return {"sent": False, "skipped": payload["skipped"]}
        return await send_alimtalk(
            conn, kind="signup", phone=payload["phone"], name=payload["name"],
            variables=payload["variables"], user_id=user_id)
    except Exception as error:  # noqa: BLE001
        print("회원가입 알림톡 실패", user_id, error)
        return {"sent": False, "error": str(error)}
