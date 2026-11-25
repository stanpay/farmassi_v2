"""
RPC `alimtalk-manual` — 관리자(슈퍼) 알림톡 수동 발송·재전송.

쓰임: 발송 실패 시 다시 보내기, 관리자가 직접 시험해 보기.

  action=templates  보낼 수 있는 템플릿(종류·코드·본문·버튼·변수)
  action=prepare    {kind, orderId | userId | logId} → 자동으로 채운 변수와 받는 사람
  action=send       {kind, orderId | userId, variables, resendOf?} → 발송

지키는 것:
  - 템플릿 본문은 바꿀 수 없다. 고칠 수 있는 건 변수 값뿐이다 (check_variables).
  - 받는 번호와 발신 채널(senderkey)은 요청에서 받지 않고 서버가 주문·프로필에서 정한다.
  - 같은 주문·종류를 이미 보냈어도 보낸다(force). 누가 보냈는지·원래 로그를 남긴다.
  - ALIMTALK_ALLOWED_PHONES(개발 서버)와 알리고 키 없음(운영 꺼짐) 규칙은 그대로 따른다.
"""
from __future__ import annotations

from typing import Any

from ..shared.alimtalk import (
    ORDER_KINDS, TEMPLATES, check_variables, normalize_phone, order_payload, send_alimtalk,
    signup_payload, template_code, template_variables,
)
from ..shared.util import is_admin
from .types import FnCtx, FnResult, fail, ok


def _mask(phone: str | None) -> str | None:
    digits = normalize_phone(phone)
    if not digits:
        return None
    return f"{digits[:3]}-****-{digits[-4:]}"


def _templates() -> list[dict[str, Any]]:
    return [
        {"kind": kind, "name": tpl["name"], "code": template_code(kind), "content": tpl["content"],
         "buttons": [b["name"] for b in tpl["buttons"]], "variables": template_variables(kind),
         "target": "user" if kind == "signup" else "order"}
        for kind, tpl in TEMPLATES.items()
    ]


async def _payload(ctx: FnCtx, kind: str, order_id: str | None, user_id: str | None,
                   *, allow_missing: bool) -> dict[str, Any]:
    if kind == "signup":
        if not user_id:
            return {"skipped": "회원가입 안내는 받을 회원을 골라야 합니다."}
        return await signup_payload(ctx.admin, user_id)
    if not order_id:
        return {"skipped": "주문을 골라야 합니다."}
    return await order_payload(ctx.admin, kind, order_id, allow_missing=allow_missing)


async def alimtalk_manual(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    if not await is_admin(ctx.admin, ctx.user_id):
        return fail("관리자만 사용할 수 있습니다.", 403)

    action = str(ctx.body.get("action") or "")
    if action == "templates":
        return ok({"templates": _templates()})

    kind = str(ctx.body.get("kind") or "")
    order_id = str(ctx.body.get("orderId") or "") or None
    user_id = str(ctx.body.get("userId") or "") or None

    if action == "prepare":
        log_id = str(ctx.body.get("logId") or "") or None
        if log_id:
            log = await ctx.admin.fetchrow(
                "select kind, order_id, user_id from public.alimtalk_logs where id = $1", log_id)
            if not log:
                return fail("발송 로그를 찾을 수 없습니다.", 404)
            kind = log["kind"]
            order_id = str(log["order_id"]) if log["order_id"] else None
            user_id = str(log["user_id"]) if log["user_id"] else None
            if kind in ORDER_KINDS and not order_id:
                return fail("이 로그에는 주문이 없어 다시 보낼 수 없습니다 (주문이 지워졌거나 시험 발송).")
        if kind not in TEMPLATES:
            return fail("kind 는 order_done·tracking·delivered·signup 중 하나여야 합니다.")
        payload = await _payload(ctx, kind, order_id, user_id, allow_missing=True)
        if "skipped" in payload:
            return fail(payload["skipped"])
        return ok({
            "kind": kind,
            "orderId": payload["order_id"],
            "userId": payload["user_id"],
            "orderNo": payload["order_no"],
            "farmName": payload["farm_name"],
            "recipientName": payload["name"],
            "recipientPhone": _mask(payload["phone"]),
            "variables": payload["variables"],
        })

    if action == "send":
        if kind not in TEMPLATES:
            return fail("kind 는 order_done·tracking·delivered·signup 중 하나여야 합니다.")
        values = ctx.body.get("variables")
        if not isinstance(values, dict):
            return fail("variables 가 필요합니다.")
        try:
            variables = check_variables(kind, values)
        except ValueError as error:
            return fail(str(error))
        payload = await _payload(ctx, kind, order_id, user_id, allow_missing=True)
        if "skipped" in payload:
            return fail(payload["skipped"])
        if not normalize_phone(payload["phone"]):
            return fail("받는 사람 휴대폰 번호가 없습니다.")

        resend_of = str(ctx.body.get("resendOf") or "") or None
        if resend_of:
            original = await ctx.admin.fetchrow(
                "select kind, order_id, user_id from public.alimtalk_logs where id = $1", resend_of)
            same = original and original["kind"] == kind and (
                str(original["order_id"]) == payload["order_id"] if kind in ORDER_KINDS
                else str(original["user_id"]) == payload["user_id"])
            if not same:
                return fail("재전송하려는 원래 로그와 종류·대상이 다릅니다.")

        result = await send_alimtalk(
            ctx.admin, kind=kind, phone=payload["phone"], name=payload["name"],
            variables=variables, sender_key=payload["sender_key"], order_id=payload["order_id"],
            user_id=payload["user_id"], farm_id=payload["farm_id"], force=True,
            sent_by=ctx.user_id, resend_of=resend_of)
        return ok(result)

    return fail("action 은 templates·prepare·send 중 하나여야 합니다.")
