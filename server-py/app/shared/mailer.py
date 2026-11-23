"""
입금 알림 메일.

구글 SMTP + 앱 비밀번호를 쓴다. 설정이 없으면 조용히 넘어간다 —
메일이 안 나간다고 입금 처리 자체가 실패하면 안 되기 때문이다.
"""
import os
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import aiosmtplib

_KST = timezone(timedelta(hours=9))

REASON_TEXT = {
    "amount_unique": "금액이 일치하는 주문이 하나뿐이라 자동 확인했습니다.",
    "deposit_code": "입금자명에 입금코드가 있어 자동 확인했습니다.",
    "recipient_name": "입금자명이 수령인과 같아 자동 확인했습니다.",
    "no_amount_match": "금액이 맞는 입금대기 주문이 없습니다.",
    "ambiguous": "금액이 같은 주문이 여러 건이라 어느 주문인지 정하지 못했습니다.",
}


def _won(n: int) -> str:
    return f"{int(n):,}원"


def _when(occurred_at: str) -> str:
    """Node 의 toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}) 와 같은 형식."""
    try:
        parsed = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
    except ValueError:
        return occurred_at
    kst = parsed.astimezone(_KST)
    ampm = "오전" if kst.hour < 12 else "오후"
    hour12 = kst.hour % 12 or 12
    return (f"{kst.year}. {kst.month}. {kst.day}. "
            f"{ampm} {hour12}:{kst.minute:02d}:{kst.second:02d}")


async def send_deposit_mail(
    *, amount: int, depositor_name: str | None, occurred_at: str, account_number: str,
    bank_name: str, matched: bool, reason: str,
    order_no: str | None = None, farm_name: str | None = None,
) -> bool:
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASSWORD")
    to = os.environ.get("DEPOSIT_MAIL_TO")
    if not user or not password or not to:
        return False

    who = depositor_name or "입금자명 없음"
    subject = (f"[입금확인] {_won(amount)} · {who} · 주문 {order_no}" if matched
               else f"[확인필요] {_won(amount)} · {who}")

    lines = [
        "입금이 확인되어 주문을 결제완료로 바꿨습니다." if matched
        else "입금이 들어왔지만 주문과 연결하지 못했습니다.",
        "",
        f"금액       {_won(amount)}",
        f"입금자명   {depositor_name or '(없음)'}",
        f"입금시각   {_when(occurred_at)}",
        f"계좌       {bank_name} {account_number}",
    ]
    if farm_name:
        lines.append(f"농가       {farm_name}")
    if order_no:
        lines.append(f"주문번호   {order_no}")
    lines += [
        "",
        REASON_TEXT.get(reason, reason),
        "" if matched else "관리자 화면 > 입금 에서 직접 확인해주세요.",
        "",
        "https://shop.lkim.me/admin/deposits",
    ]

    message = EmailMessage()
    message["From"] = f"팜어시 입금알림 <{user}>"
    message["To"] = to
    message["Subject"] = subject
    message.set_content("\n".join(lines))

    try:
        await aiosmtplib.send(
            message,
            hostname=os.environ.get("SMTP_HOST") or "smtp.gmail.com",
            port=int(os.environ.get("SMTP_PORT") or 465),
            use_tls=True,
            username=user,
            password=password,
        )
        return True
    except Exception as error:  # noqa: BLE001
        print("입금 메일 발송 실패", error)
        return False


async def send_order_mail(
    *, order_no: str, farm_name: str, amount: int, deposit_code: str,
    recipient_name: str, recipient_phone: str, address: str,
    items: list[dict], memo: str | None = None,
) -> bool:
    """
    새 주문 알림 메일.

    웹푸시가 이미 있지만 브라우저 구독이 있어야 도착한다. 실제로 관리자가
    농가 owner 인데도 구독이 없어 아무 알림도 못 받고 있었다. 메일은 그런
    전제가 없어서 확실하다.
    """
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASSWORD")
    to = os.environ.get("ORDER_MAIL_TO") or os.environ.get("DEPOSIT_MAIL_TO")
    if not user or not password or not to:
        return False

    listed = ", ".join(f"{i['name']} ×{i['quantity']}" for i in items)
    lines = [
        f"{farm_name} 에 새 주문이 들어왔습니다.",
        "",
        f"주문번호   {order_no}",
        f"상품       {listed}",
        f"금액       {_won(amount)}",
        f"입금자명   {deposit_code}",
        "",
        f"받는 분    {recipient_name} · {recipient_phone}",
        f"주소       {address}",
    ]
    if memo:
        lines.append(f"요청사항   {memo}")
    lines += [
        "",
        "입금이 확인되면 자동으로 결제완료가 됩니다.",
        "뱅크다에 계좌가 등록되지 않은 농가는 직접 확인해야 합니다.",
        "",
        "https://farmassi.kr/admin/orders",
    ]

    message = EmailMessage()
    message["From"] = f"팜어시 주문알림 <{user}>"
    message["To"] = to
    message["Subject"] = f"[새주문] {farm_name} · {_won(amount)} · {recipient_name}"
    message.set_content("\n".join(lines))

    try:
        await aiosmtplib.send(
            message,
            hostname=os.environ.get("SMTP_HOST") or "smtp.gmail.com",
            port=int(os.environ.get("SMTP_PORT") or 465),
            use_tls=True, username=user, password=password,
        )
        return True
    except Exception as error:  # noqa: BLE001
        print("주문 메일 발송 실패", error)
        return False


async def send_admin_mail(*, subject: str, lines: list[str]) -> bool:
    """관리자 확인이 필요한 일 (예: 알림톡·문자 모두 실패).

    받는 곳은 ALERT_MAIL_TO, 없으면 입금 알림을 받는 DEPOSIT_MAIL_TO.
    """
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASSWORD")
    to = os.environ.get("ALERT_MAIL_TO") or os.environ.get("DEPOSIT_MAIL_TO")
    if not user or not password or not to:
        return False

    message = EmailMessage()
    message["From"] = f"팜어시 알림 <{user}>"
    message["To"] = to
    message["Subject"] = subject
    message.set_content("\n".join(lines))
    try:
        await aiosmtplib.send(
            message,
            hostname=os.environ.get("SMTP_HOST") or "smtp.gmail.com",
            port=int(os.environ.get("SMTP_PORT") or 465),
            use_tls=True,
            username=user,
            password=password,
        )
        return True
    except Exception as error:  # noqa: BLE001
        print("관리자 메일 발송 실패", error)
        return False
