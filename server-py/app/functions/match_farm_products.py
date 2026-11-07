"""농가 카탈로그 상품 매칭. Anthropic Claude Messages API."""
from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

from .types import FnCtx, FnResult, fail, ok

MODEL = "claude-sonnet-5-5"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

SYSTEM_PROMPT = """당신은 농가 상품 카탈로그 매칭기다. JSON만 출력한다.

규칙:
- catalog 에 있는 상품만 고른다. 새 이름을 만들지 않는다.
- 고객 문구의 무게(kg/키로)가 있으면 카탈로그 상품 무게와 같아야 한다.
- 품종 통칭·별칭은 허용한다. 예: "포도" ↔ 캠벨/거봉/샤인머스켓, "사과" ↔ 부사/홍로.
- 즙·주스 요청은 즙·주스 상품에만, 생과는 생과에만 연결한다.
- 확신이 없거나 후보가 여러 개로 갈리면 productId 를 null 로 둔다.
- 입력 queries 순서와 같은 길이의 matches 배열을 반환한다.

출력 JSON:
{
  "matches": [
    { "query": string, "productId": string | null }
  ]
}"""


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
        raise Exception("상품 매칭 응답이 JSON이 아닙니다.")
    return json.loads(candidate[start : end + 1])


async def match_farm_products_with_claude(
    queries: list[str],
    catalog: list[dict[str, str]],
) -> list[str | None]:
    cleaned = [q.strip() for q in queries]
    if not cleaned:
        return []
    if not catalog:
        return [None for _ in cleaned]

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            ANTHROPIC_URL,
            headers={
                "content-type": "application/json",
                "x-api-key": _api_key(),
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": MODEL,
                "max_tokens": 2048,
                "system": SYSTEM_PROMPT,
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            f"catalog:\n{json.dumps(catalog, ensure_ascii=False, indent=2)}\n\n"
                            f"queries:\n{json.dumps(cleaned, ensure_ascii=False, indent=2)}\n\n"
                            "각 query 에 맞는 catalog.id 를 골라 JSON으로만 답하세요."
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
    matches_in = parsed.get("matches") if isinstance(parsed, dict) else None
    allowed = {row["id"] for row in catalog}
    by_query: dict[str, str | None] = {}
    list_rows: list[Any] = matches_in if isinstance(matches_in, list) else []

    for item in list_rows:
        if not isinstance(item, dict):
            continue
        query = str(item.get("query") or "").strip()
        product_id = item.get("productId")
        product_id = product_id if isinstance(product_id, str) else None
        if not query:
            continue
        by_query[query] = product_id if product_id in allowed else None

    result: list[str | None] = []
    for index, query in enumerate(cleaned):
        if query in by_query:
            result.append(by_query[query])
            continue
        row = list_rows[index] if index < len(list_rows) else None
        product_id = row.get("productId") if isinstance(row, dict) else None
        product_id = product_id if isinstance(product_id, str) else None
        result.append(product_id if product_id in allowed else None)
    return result


async def match_farm_products(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    try:
        body = ctx.body or {}
        raw_queries = body.get("queries")
        queries = [str(item or "") for item in raw_queries] if isinstance(raw_queries, list) else []
        raw_products = body.get("products")
        catalog: list[dict[str, str]] = []
        if isinstance(raw_products, list):
            for item in raw_products:
                if not isinstance(item, dict):
                    continue
                product_id = str(item.get("id") or "")
                name = str(item.get("name") or "")
                if product_id and name:
                    catalog.append({"id": product_id, "name": name})
        if not queries:
            return fail("queries 가 필요합니다.")
        product_ids = await match_farm_products_with_claude(queries, catalog)
        return ok({"productIds": product_ids})
    except Exception as error:
        return fail(str(error) or "상품 매칭에 실패했습니다.", 500)
