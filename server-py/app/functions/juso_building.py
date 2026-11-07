"""
행정안전부 도로명주소 API(business.juso.go.kr)로 건물의 동·호 정보를 조회한다.

- 검색 API: 공동주택 여부(bdKdcd)와 상세주소 API 를 부를 건물 키
- 상세주소 API: 건물의 동 목록, 동별 호 목록

승인키는 서버 환경변수(JUSO_SEARCH_API_KEY, JUSO_DETAIL_API_KEY)에만 둔다.
"""
from __future__ import annotations

import asyncio
import os
import re

import httpx

from .types import FnCtx, FnResult, fail, ok

SEARCH_ENDPOINT = "https://business.juso.go.kr/addrlink/addrLinkApi.do"
DETAIL_ENDPOINT = "https://business.juso.go.kr/addrlink/addrDetailApi.do"

# 동 목록에 섞여 오는 주거용이 아닌 동
NON_RESIDENTIAL_DONG = re.compile(
    r"상가|관리|경비|노인|경로|주차|어린이|보육|유치원|커뮤니티|부대|근린|복리|"
    r"기계|전기|변전|펌프|창고|사무|문고|독서|헬스|피트니스|휘트니스|공용|종교|교회"
)


def _key(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise Exception(f"도로명주소 API 키({name})가 설정되지 않았습니다.")
    return value


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value)


def _road_base(address: str) -> str:
    """'서울특별시 강서구 강서로 532 (가양동, …) 101동~110동' → '서울특별시 강서구 강서로 532'"""
    return re.split(r"\s*\(", address.strip(), maxsplit=1)[0].strip()


def _dong_key(value: str) -> str:
    return re.sub(r"동$", "", _compact(value)).upper()


async def _get(client: httpx.AsyncClient, url: str, params: dict) -> list[dict]:
    response = await client.get(url, params={**params, "resultType": "json"})
    response.raise_for_status()
    results = response.json().get("results") or {}
    common = results.get("common") or {}
    if common.get("errorCode") not in ("0", 0, None):
        raise Exception(common.get("errorMessage") or "도로명주소 조회에 실패했습니다.")
    return results.get("juso") or []


def _pick_building(rows: list[dict], road: str) -> dict | None:
    target = _compact(road)
    exact = [row for row in rows if _compact(row.get("roadAddrPart1", "")) == target]
    if len(exact) == 1:
        return exact[0]
    return rows[0] if len(rows) == 1 else None


async def _lookup(road: str, dong: str) -> dict:
    not_found = {"found": False, "apartment": False, "buildingName": "", "dongs": [], "hos": None, "hoDong": None}
    async with httpx.AsyncClient(timeout=15.0) as client:
        rows = await _get(
            client,
            SEARCH_ENDPOINT,
            {"confmKey": _key("JUSO_SEARCH_API_KEY"), "keyword": road, "currentPage": 1, "countPerPage": 20},
        )
        building = _pick_building(rows, road)
        if building is None:
            return not_found

        building_key = {
            "admCd": building.get("admCd", ""),
            "rnMgtSn": building.get("rnMgtSn", ""),
            "udrtYn": building.get("udrtYn", ""),
            "buldMnnm": building.get("buldMnnm", ""),
            "buldSlno": building.get("buldSlno", ""),
        }
        detail_key = _key("JUSO_DETAIL_API_KEY")

        async def fetch_hos(dong_name: str) -> list[str]:
            ho_rows = await _get(
                client,
                DETAIL_ENDPOINT,
                {"confmKey": detail_key, **building_key, "searchType": "floorho", "dongNm": dong_name},
            )
            return list(dict.fromkeys((row.get("hoNm") or "").strip() for row in ho_rows if row.get("hoNm")))

        # 동 목록을 기다리지 않고 '103동' 형태(동이 없으면 '')로 호 목록을 함께 받아 둔다.
        guessed_dong = f"{_dong_key(dong)}동" if dong else ""
        dong_rows, guessed_hos = await asyncio.gather(
            _get(client, DETAIL_ENDPOINT, {"confmKey": detail_key, **building_key, "searchType": "dong"}),
            fetch_hos(guessed_dong),
        )
        # '' 은 동 이름이 없는 단일 건물이다.
        unit_dongs = list(
            dict.fromkeys(
                (row.get("dongNm") or "").strip()
                for row in dong_rows
                if not NON_RESIDENTIAL_DONG.search(row.get("dongNm") or "")
            )
        )

        target = next(
            (name for name in unit_dongs if dong and name and _dong_key(name) == _dong_key(dong)),
            None,
        )
        if target is None and (unit_dongs == [""] or (not dong and len(unit_dongs) == 1)):
            target = unit_dongs[0]

        hos = None
        if target is not None:
            hos = guessed_hos if target == guessed_dong else await fetch_hos(target)

        return {
            "found": True,
            "apartment": str(building.get("bdKdcd", "")) == "1",
            "buildingName": building.get("bdNm", "") or "",
            "dongs": [name for name in unit_dongs if name],
            "hos": hos,
            "hoDong": target,
        }


async def juso_building(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    road = _road_base(str(ctx.body.get("address") or ""))
    if len(road) < 2:
        return fail("주소를 입력해 주세요.")
    dong = str(ctx.body.get("dong") or "").strip()
    try:
        return ok(await _lookup(road, dong))
    except Exception as error:  # noqa: BLE001
        return fail(str(error) or "도로명주소 조회에 실패했습니다.", 500)
