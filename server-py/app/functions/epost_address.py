"""
우체국(우정사업본부) 통합검색 5자리 우편번호 조회.

공공데이터포털 '우편번호 정보조회' Open API 프록시.
브라우저에 serviceKey 를 노출하지 않기 위해 서버에서만 호출한다.
"""
from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
from urllib.parse import unquote

import httpx

from .types import FnCtx, FnResult, fail, ok

ENDPOINT = (
    "http://openapi.epost.go.kr/postal/"
    "retrieveNewAdressAreaCdSearchAllService/"
    "retrieveNewAdressAreaCdSearchAllService/"
    "getNewAddressListAreaCdSearchAll"
)

_TAG = re.compile(r"\{.*\}")


def _local(tag: str) -> str:
    return _TAG.sub("", tag)


def _text(node: ET.Element | None) -> str:
    if node is None or node.text is None:
        return ""
    return node.text.strip()


def _service_key() -> str:
    raw = (os.environ.get("EPOST_SERVICE_KEY") or "").strip()
    if not raw:
        raise Exception("우체국 Open API 키(EPOST_SERVICE_KEY)가 설정되지 않았습니다.")
    # 포털에서 복사한 인코딩 키(%2B 등)를 한 번 풀어 httpx 가 다시 인코딩하게 한다.
    return unquote(raw) if "%" in raw else raw


def _parse_results(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    header = None
    items: list[ET.Element] = []
    for child in root:
        name = _local(child.tag)
        if name == "cmmMsgHeader":
            header = child
        elif name == "newAddressListAreaCdSearchAll":
            items.append(child)

    if header is not None:
        success = _text(next((c for c in header if _local(c.tag) == "successYN"), None))
        if success == "N":
            err = _text(next((c for c in header if _local(c.tag) == "errMsg"), None))
            code = _text(next((c for c in header if _local(c.tag) == "returnCode"), None))
            raise Exception(err or f"우체국 주소 조회 실패 (코드 {code or '?'})")

    results: list[dict] = []
    for item in items:
        fields = {_local(c.tag): _text(c) for c in item}
        zip_no = fields.get("zipNo", "")
        # 이 서비스 명세: lnmAdres=도로명, rnAdres=지번
        road = fields.get("lnmAdres", "")
        jibun = fields.get("rnAdres", "")
        if not zip_no and not road and not jibun:
            continue
        results.append(
            {
                "id": f"epost:{zip_no}:{road}:{jibun}",
                "zipNo": zip_no,
                "roadAddress": road,
                "jibunAddress": jibun,
            }
        )
    return results


async def _search(query: str, count_per_page: int, current_page: int) -> list[dict]:
    params = {
        "serviceKey": _service_key(),
        "srchwrd": query,
        "countPerPage": str(max(1, min(count_per_page, 50))),
        "currentPage": str(max(1, current_page)),
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(ENDPOINT, params=params)
        response.raise_for_status()
        return _parse_results(response.text)


async def epost_address(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    try:
        query = (ctx.body.get("query") or "").strip()
        if len(query) < 2:
            return fail("검색어를 입력해 주세요.")
        count = int(ctx.body.get("countPerPage") or 20)
        page = int(ctx.body.get("currentPage") or 1)
        return ok({"results": await _search(query, count, page)})
    except ValueError:
        return fail("요청이 올바르지 않습니다.")
    except Exception as error:  # noqa: BLE001
        return fail(str(error) or "우체국 주소 조회에 실패했습니다.", 500)
