"""카톡 주문 메시지 → 구조화. Anthropic Claude Messages API.

문자열은 원문을 자르거나 공백만 다루는 수준으로만 옮긴다. 재생성·교정 금지.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

from .types import FnCtx, FnResult, fail, ok

MODEL = "claude-sonnet-5-5"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

SYSTEM_PROMPT = """당신은 한국 카카오톡 주문 대화에서 주문을 찾아 JSON으로만 표시하는 파서다.
문자를 다시 쓰지 않는다. 모든 문자열은 원문 부분문자열이다.

규칙 (분리·병합·무시는 정해진 패턴이 아니라 대화 맥락으로 판단한다):
- 주문: 받는 사람이나 배송지를 알 수 있는 내용이 주문이다. 받는 사람이나 배송지가 다르면 다른 주문이다.
  같은 주소라도 받는 사람·상품이 다르면 다른 주문일 수 있다.
- 한 말풍선에 이름·전화·주소가 여러 줄로 이어지면 그 전체가 한 주문이다. raw 는 그 말풍선 본문 전체.
- 내용이 부족한 조각(상품·수량·전화·보내는분 등만 있고 혼자서는 주문이 안 되는 것)은 먼저 미연결로 본다.
  한 말풍선에 여러 조각이 섞여 있으면 조각별로 나눠서 판단한다.
- 병합: 미연결 조각이 기존 주문과 겹치는 단서(지역·주소 일부·이름·전화·상품 등, 오타·약칭 포함. 예: 노윈구=노원구)가 있으면
  그 주문의 보완이다. 그 주문의 빈 필드를 채우고, 조각 원문을 그 주문의 supplements 에 넣는다.
  그 주문에 이미 같은 내용이 있어도 그 주문을 가리키는 조각이면 supplements 에 넣는다.
- 겹치는 주문이 없는 조각은 새 주문으로 만들지 않고 orders·supplements·ignored 어디에도 넣지 않는다(화면에 미연결로 표시된다).
- 무시: 이미 보낸 주문 내용을 그대로 다시 보낸 재전송, 대화 상대 닉네임처럼 주문이 아닌 문구는 ignored 에 원문 구간을 넣는다.
  같은 주소라도 새 정보가 있으면 무시하지 말고 병합하거나 별도 주문으로 둔다.
- raw·supplements·ignored 구간끼리 겹치지 않게.
- 카톡 시간·닉네임·"메시지가 삭제되었습니다"는 필드로 쓰지 않는다.
- phone/address/addressDetail/이름은 원문 그대로. 포맷을 바꾸지 말 것.
- recipientName/phone=받는분, senderName/senderPhone=보내는분, depositorName=입금자.
- quantity만 숫자(불명=1). 없으면 빈 문자열.
- highlight.* 도 원문 부분문자열(본문이나 supplements 안). highlight.quantity 는 수량을 나타내는 원문 문구 그대로(예: "2박스", "한박스", "하나", "1개").

출력 JSON:
{
  "orders": [
    {
      "raw": string,
      "blockStart": number | null,
      "blockEnd": number | null,
      "recipientName": string,
      "phone": string,
      "address": string,
      "addressDetail": string,
      "product": string,
      "quantity": number,
      "senderName": string,
      "senderPhone": string,
      "depositorName": string,
      "memo": string,
      "highlight": {
        "recipientName"?: string,
        "phone"?: string,
        "address"?: string,
        "product"?: string,
        "quantity"?: string,
        "senderName"?: string,
        "senderPhone"?: string,
        "depositorName"?: string,
        "memo"?: string
      },
      "supplements": string[]
    }
  ],
  "ignored": string[]
}"""

_FIELD_KEYS = (
    "recipientName",
    "phone",
    "address",
    "addressDetail",
    "product",
    "senderName",
    "senderPhone",
    "depositorName",
    "memo",
)

_HIGHLIGHT_KEYS = (
    "recipientName",
    "phone",
    "address",
    "product",
    "quantity",
    "senderName",
    "senderPhone",
    "depositorName",
    "memo",
)


def _api_key() -> str:
    raw = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not raw:
        raise Exception("Claude API 키(ANTHROPIC_API_KEY)가 설정되지 않았습니다.")
    return raw


def _extract_json(text: str) -> Any:
    trimmed = text.strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", trimmed)
    candidate = fenced.group(1).strip() if fenced else trimmed
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start < 0 or end < start:
        raise Exception("주문 파싱 응답이 JSON이 아닙니다.")
    return json.loads(candidate[start : end + 1])


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    return value if isinstance(value, str) else str(value)


def _as_nullable_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _recover_exact_slice(haystack: str, needle: str) -> str:
    trimmed = needle.strip()
    if not trimmed or not haystack:
        return ""
    if trimmed in haystack:
        return trimmed

    compact_needle = re.sub(r"\s+", "", trimmed)
    if not compact_needle:
        return ""

    compact_index: list[int] = []
    for i, ch in enumerate(haystack):
        if ch.isspace():
            continue
        compact_index.append(i)
    compact_hay = re.sub(r"\s+", "", haystack)
    at = compact_hay.find(compact_needle)
    if at < 0:
        return ""
    start = compact_index[at]
    end_exclusive = compact_index[at + len(compact_needle) - 1] + 1
    return haystack[start:end_exclusive]


def _nearest_index_of(source: str, needle: str, hint: int | None) -> int:
    best = -1
    at = source.find(needle)
    while at >= 0:
        if best < 0 or (hint is not None and abs(at - hint) < abs(best - hint)):
            best = at
        at = source.find(needle, at + 1)
    return best


def _resolve_raw(source: str, row: dict) -> tuple[str, int | None, int | None] | None:
    block_start = _as_nullable_int(row.get("blockStart"))
    block_end = _as_nullable_int(row.get("blockEnd"))

    # Claude 가 센 문자 위치는 자주 어긋나므로 raw 문자열을 원문에서 찾는 것을 우선한다.
    recovered = _recover_exact_slice(source, _as_str(row.get("raw")))
    found = _nearest_index_of(source, recovered, block_start) if recovered else -1
    if found >= 0:
        return recovered, found, found + len(recovered)

    if (
        block_start is not None
        and block_end is not None
        and block_start >= 0
        and block_end > block_start
        and block_end <= len(source)
    ):
        return source[block_start:block_end], block_start, block_end
    return None


def _recover_slices(source: str, value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    recovered = (_recover_exact_slice(source, _as_str(item)) for item in value)
    return [item for item in recovered if item]


def _normalize_order(raw_order: Any, source: str) -> dict | None:
    if not isinstance(raw_order, dict):
        return None
    resolved = _resolve_raw(source, raw_order)
    if not resolved:
        return None
    raw, block_start, block_end = resolved

    fields: dict[str, str] = {}
    for key in _FIELD_KEYS:
        claimed = _as_str(raw_order.get(key))
        fields[key] = _recover_exact_slice(raw, claimed) or _recover_exact_slice(source, claimed)

    highlight_in = raw_order.get("highlight") if isinstance(raw_order.get("highlight"), dict) else {}
    # 병합된 보완 말풍선에만 있는 값(예: 수량 "2박스")도 하이라이트로 남긴다.
    supplements = _recover_slices(source, raw_order.get("supplements"))
    highlight_scope = [raw, *supplements]
    highlight: dict[str, str] = {}
    for key in _HIGHLIGHT_KEYS:
        claimed = _as_str(highlight_in.get(key))
        recovered = next(
            (hit for hit in (_recover_exact_slice(text, claimed) for text in highlight_scope) if hit),
            "",
        )
        if not recovered and key in fields:
            recovered = fields[key]
        if recovered and any(recovered in text for text in highlight_scope):
            highlight[key] = recovered

    if "address" not in highlight:
        combined = " ".join(x for x in (fields.get("address"), fields.get("addressDetail")) if x)
        recovered_combined = _recover_exact_slice(raw, combined)
        if recovered_combined:
            highlight["address"] = recovered_combined
        elif fields.get("address") and fields["address"] in raw:
            highlight["address"] = fields["address"]

    try:
        quantity = int(raw_order.get("quantity") or 1)
    except (TypeError, ValueError):
        quantity = 1
    if quantity <= 0:
        quantity = 1

    return {
        "raw": raw,
        "blockStart": block_start,
        "blockEnd": block_end,
        "recipientName": fields["recipientName"],
        "phone": fields["phone"],
        "address": fields["address"],
        "addressDetail": fields["addressDetail"],
        "product": fields["product"],
        "quantity": quantity,
        "senderName": fields["senderName"],
        "senderPhone": fields["senderPhone"],
        "depositorName": fields["depositorName"],
        "memo": fields["memo"],
        "highlight": highlight,
        "supplements": supplements,
    }


async def parse_order_messages_text(text: str) -> dict:
    source = text  # trim 하지 않음 — 인덱스가 원문과 어긋나지 않게
    if len(source.strip()) < 2:
        raise Exception("주문 메시지를 입력해 주세요.")

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            ANTHROPIC_URL,
            headers={
                "content-type": "application/json",
                "x-api-key": _api_key(),
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": MODEL,
                "max_tokens": 8192,
                "system": SYSTEM_PROMPT,
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "다음 카톡 원문에서 주문을 JSON으로만 표시하세요. "
                            "분리·병합·무시는 대화 맥락으로 판단하고, "
                            "문자를 다시 쓰지 마세요.\n\n"
                            f"---\n{source}\n---"
                        ),
                    }
                ],
            },
        )

    payload = response.json() if response.content else {}
    if response.status_code >= 400:
        err = payload.get("error") if isinstance(payload, dict) else None
        message = err.get("message") if isinstance(err, dict) else None
        raise Exception(message or f"Claude API 오류 (HTTP {response.status_code})")

    parts = payload.get("content") if isinstance(payload, dict) else None
    text_out = ""
    if isinstance(parts, list):
        text_out = "\n".join(
            part.get("text", "")
            for part in parts
            if isinstance(part, dict) and part.get("type") == "text" and part.get("text")
        )
    if not text_out.strip():
        raise Exception("Claude 응답이 비어 있습니다.")

    parsed = _extract_json(text_out)
    orders_in = parsed.get("orders") if isinstance(parsed, dict) else None
    orders = []
    if isinstance(orders_in, list):
        for item in orders_in:
            normalized = _normalize_order(item, source)
            if normalized:
                orders.append(normalized)
    if not orders:
        raise Exception("추출된 주문이 없습니다.")
    ignored = _recover_slices(source, parsed.get("ignored") if isinstance(parsed, dict) else None)
    return {"orders": orders, "ignored": ignored}


async def parse_order_messages(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    try:
        text = str((ctx.body or {}).get("text") or "")
        return ok(await parse_order_messages_text(text))
    except Exception as error:
        return fail(str(error) or "주문 메시지 파싱에 실패했습니다.", 500)
