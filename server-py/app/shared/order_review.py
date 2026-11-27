"""
농가 「직접 추가」 주문 검수 — 화면(OrderCreate)과 챗봇이 같은 판정을 쓰도록 서버로 옮긴 것.

화면 코드와 1:1 로 맞춘 부분 (고칠 때 양쪽을 같이 본다)
  src/lib/epostAddress.ts   splitAddressParts · normalizeAddressParts · buildEpostSearchQuery ·
                            extractAddressDetail · buildEpostFallbackQueries · findDistrictMismatch ·
                            matchesEpostResult · resolveUniqueEpostMatch
  src/lib/jusoBuilding.ts   parseDongHo · judgeAddressDetail · checkAddressDetail
  src/lib/phone.ts          normalizePhone
  src/lib/matchFarmProduct.ts matchFarmProduct
  src/pages/farm/OrderCreate.tsx validateDraftAddress · applyAddressSelection · REQUIRED_FIELD_ERRORS

doc/plan/기획-챗봇-주문검수-작업.md, doc/backend/orders/command/review-farm-orders.md
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import re
import time
from typing import Any, Awaitable, Callable

# ───────────────────────── 주소 문구 (epostAddress.ts) ─────────────────────────

_WS = re.compile(r"\s+")


def _squash(value: str) -> str:
    return _WS.sub(" ", value or "").strip()


def split_address_parts(value: str) -> tuple[str, str]:
    """'서울 강서구 강서로 532, 103동 801호(가양동 동신아파트)' → ('서울 강서구 강서로 532', '103동 801호(…)')"""
    full = _squash(value)
    if not full:
        return "", ""
    m = re.match(r"^(.+?(?:대로|로|길|리|가)\s*\d+(?:-\d+)?)(?:\s*,\s*|\s*,)(.+)$", full, re.I)
    if m and m.group(1).strip() and m.group(2).strip():
        return m.group(1).strip(), m.group(2).strip()
    m = re.match(r"^(.+?(?:대로|로|길|리|가)\s*\d+(?:-\d+)?)(?:\s+)(.+)$", full, re.I)
    if m:
        base, detail = m.group(1).strip(), m.group(2).strip()
        if base and detail and re.search(
                r"\d+\s*동|\d+\s*호|아파트|APT|빌라|빌딩|타워|오피스텔|\([^)]+\)", detail, re.I):
            return base, detail
    m = re.match(
        r"^(.*?\d(?:-\d+)?)\s+((?:[가-힣A-Za-z0-9]+\s*)*(?:아파트|APT|Apt|빌라|빌딩|타워)?\s*\d+\s*동\s*\d+\s*호.*)$",
        full, re.I)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return full, ""


def normalize_address_parts(address: str, detail: str) -> tuple[str, str]:
    base = _squash(address)
    detail = _squash(detail)
    if not base:
        return "", detail
    if re.search(r",\s*\d+\s*동|,.*호|\d+\s*동\s*\d+\s*호|(?:아파트|APT|빌라).*\d+\s*동", base, re.I):
        split_base, split_detail = split_address_parts(base)
        if split_detail:
            return split_base, " ".join(x for x in (split_detail, detail) if x).strip()
    if detail:
        return base, detail
    return split_address_parts(base)


def build_epost_search_query(address: str) -> str:
    text = _squash(address)
    m = re.match(r"^(.*?[가-힣A-Za-z0-9]+(?:대로|로|길)(?:\s*\d+(?:번)?(?:길|로))?\s*\d+(?:-\d+)?)(?!\d)", text)
    if m:
        text = m.group(1)
    text = re.sub(r"\s*\d+\s*동\s*\d+\s*호(?=\s|$)", " ", text)
    text = re.sub(r"\s*\d+\s*동(?=\s|$)", " ", text)
    text = re.sub(r"\s*\d+\s*호(?=\s|$)", " ", text)
    text = re.sub(r"(대로|로|길|리|가)(\d)", r"\1 \2", text)
    text = re.sub(r"(\d)(?!동|호|길|로)([가-힣A-Za-z])", r"\1 \2", text)
    text = re.sub(r"\s+(?:[가-힣A-Za-z]+\s+)*[가-힣A-Za-z]*?(아파트|APT|Apt|빌라|빌딩|타워|오피스텔|주상복합).*$",
                  " ", text, flags=re.I)
    return _squash(text)


def extract_address_detail(address: str, road_address: str) -> str:
    normalized, road = _squash(address), _squash(road_address)
    if not normalized or not road:
        return ""

    def compact(value: str) -> str:
        return re.sub(r"\s+", "", re.sub(r"특별시|광역시|특별자치시|특별자치도", "", value)).lower()

    if compact(road) not in compact(normalized):
        m = re.search(r"([가-힣A-Za-z0-9]+(?:아파트|APT)?\s*\d+\s*동\s*\d+\s*호.*)$", normalized, re.I)
        return m.group(1).strip() if m else ""
    m = re.search(r"((?:[가-힣A-Za-z0-9]+(?:아파트|APT|Apt)?)\s*)?\d+\s*동\s*\d+\s*호.*$", normalized, re.I)
    return m.group(0).strip() if m else ""


_SIDO_ALIASES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^(서울|부산|대구|인천|광주|대전|울산)(?:특별시|광역시|시)?"), r"\1"),
    (re.compile(r"^세종(?:특별자치시|시)?"), "세종"),
    (re.compile(r"^경기도?"), "경기"),
    (re.compile(r"^강원(?:특별자치도|도)?"), "강원"),
    (re.compile(r"^(?:충청북도|충북)"), "충북"),
    (re.compile(r"^(?:충청남도|충남)"), "충남"),
    (re.compile(r"^(?:전라북도|전북특별자치도|전북)"), "전북"),
    (re.compile(r"^(?:전라남도|전남)"), "전남"),
    (re.compile(r"^(?:경상북도|경북)"), "경북"),
    (re.compile(r"^(?:경상남도|경남)"), "경남"),
    (re.compile(r"^제주(?:특별자치도|도)?"), "제주"),
]


def _normalize_sido(value: str) -> str:
    text = value.strip()
    for pattern, replacement in _SIDO_ALIASES:
        if pattern.search(text):
            return pattern.sub(replacement, text, count=1)
    return text


def _compact_address(value: str) -> str:
    return re.sub(r"\s+", "", re.sub(r"\([^)]*\)", "", _normalize_sido(value))).lower()


def _leading_sido(address: str) -> str:
    tokens = address.strip().split()
    first = tokens[0] if tokens else ""
    return _normalize_sido(first) if any(p.search(first) for p, _ in _SIDO_ALIASES) else ""


def _road_with_number(address: str) -> str:
    m = re.search(r"([가-힣A-Za-z0-9]+(?:대로|로|길)(?:\s*\d+(?:번)?(?:길|로))?)\s+(\d+(?:-\d+)?)",
                  build_epost_search_query(address))
    return (_WS.sub("", m.group(1)) + " " + m.group(2)) if m else ""


def build_epost_fallback_queries(address: str) -> list[str]:
    """'인천 서구 용해로20 …' → ['인천 용해로 20', '용해로 20'] (시·군·구가 바뀌었을 때)"""
    road = _road_with_number(address)
    if not road:
        return []
    sido = _leading_sido(address)
    return list(dict.fromkeys(q for q in (f"{sido} {road}" if sido else "", road) if q))


def _same_road_key(address: str, result: dict) -> bool:
    road = _road_with_number(address)
    if not road or road != _road_with_number(result.get("roadAddress", "")):
        return False
    sido = _leading_sido(address)
    return not sido or sido == _leading_sido(result.get("roadAddress", ""))


def _district_of(address: str) -> str:
    tokens = address.strip().split()
    start = 1 if _leading_sido(address) else 0
    return next((t for t in tokens[start:] if re.fullmatch(r"[가-힣]+(?:시|군|구)", t)), "")


def matches_epost_result(address: str, result: dict) -> bool:
    if not address.strip():
        return False
    target = _compact_address(address)
    if not target:
        return False
    road = _compact_address(result.get("roadAddress", ""))
    if len(road) >= 6 and (road in target or target in road):
        return True
    jibun = _compact_address(result.get("jibunAddress", ""))
    return len(jibun) >= 6 and (jibun in target or target in jibun)


def find_district_mismatch(address: str, result: dict) -> tuple[str, str] | None:
    if matches_epost_result(address, result) or not _same_road_key(address, result):
        return None
    original, epost = _district_of(address), _district_of(result.get("roadAddress", ""))
    return (original, epost) if original and epost and original != epost else None


def resolve_unique_epost_match(address: str, results: list[dict]) -> dict | None:
    if len(results) != 1:
        return None
    return results[0] if matches_epost_result(address, results[0]) else None


# ───────────────────────── 동·호 (jusoBuilding.ts) ─────────────────────────

_DONG_PATTERNS = [
    re.compile(r"(?<!\d)(\d{3,4})\s*동(?![가-힣])"),
    re.compile(r"(?<![가-힣\d])(\d{1,2}|[A-Za-z]|[가나다라마바사아자차카타파하])\s*동(?![가-힣])"),
]
_HO_PATTERN = re.compile(r"(?<!\d)([A-Za-z]?\d{1,5})\s*호(?!선)")
_DASH_PATTERN = re.compile(r"(?<![\d-])(\d{1,4})\s*-\s*(\d{1,5})(?![\d-])")
_MULTI_UNIT_HINT = re.compile(r"아파트|APT|빌라|맨션|오피스텔|연립|다세대|타운|하이츠|캐슬|빌리지", re.I)


def parse_dong_ho(detail: str) -> tuple[str, str]:
    text = _squash(detail)
    dong = next((m.group(1) for m in (p.search(text) for p in _DONG_PATTERNS) if m), "")
    ho_match = _HO_PATTERN.search(text)
    ho = ho_match.group(1) if ho_match else ""
    if not dong and not ho:
        dash = _DASH_PATTERN.search(text)
        if dash:
            return dash.group(1), dash.group(2)
    return dong.upper(), ho.upper()


def _unit_key(value: str, suffix: str) -> str:
    return re.sub(f"{suffix}$", "", re.sub(r"\s+", "", value)).upper()


def _natural(value: str) -> list:
    """localeCompare(…, { numeric: true }) 근사 — 숫자 덩어리는 수로 비교한다."""
    return [(0, int(part), "") if part.isdigit() else (1, 0, part) for part in re.findall(r"\d+|\D+", value)]


def _summarize_dongs(dongs: list[str]) -> str:
    ordered = sorted(dongs, key=_natural)
    if len(ordered) <= 4:
        return ", ".join(ordered)
    return f"{ordered[0]}~{ordered[-1]} 등 {len(ordered)}개 동"


def judge_address_detail(info: dict, dong: str, ho: str) -> list[tuple[str, str]]:
    """[(code, 문구)] — 문제가 없으면 빈 목록. 문구를 ' · ' 로 잇고 '. 확인해 주세요.' 를 붙이면 화면 문구와 같다."""
    problems: list[tuple[str, str]] = []
    dongs: list[str] = info.get("dongs") or []
    hos: list[str] | None = info.get("hos")
    has_dong = any(_unit_key(name, "동") == _unit_key(dong, "동") for name in dongs)
    if not dong and len(dongs) >= 2:
        problems.append(("MISSING_DONG", f"동이 빠졌습니다 ({_summarize_dongs(dongs)})"))
    elif dong and dongs and not has_dong:
        problems.append(("INVALID_DONG", f"{dong}동은 이 건물에 없습니다 ({_summarize_dongs(dongs)})"))

    needs_ho = bool(info.get("apartment")) or bool(dongs) or bool(hos)
    if not ho and needs_ho:
        problems.append(("MISSING_HO", "호수가 빠졌습니다"))
    elif ho and hos:
        if not any(_unit_key(name, "호") == _unit_key(ho, "호") for name in hos):
            ho_dong = info.get("hoDong")
            where = f"{ho_dong} " if ho_dong else ""
            ordered = sorted(hos, key=_natural)
            span = f"{ordered[0]}~{ordered[-1]}" if len(ordered) > 1 else ordered[0]
            subject = f"{ho_dong}은" if ho_dong else "이 건물은"
            problems.append(("INVALID_HO", f"{where}{ho}호는 등록된 호수에 없습니다. {subject} {span}입니다"))
    return problems


def detail_problem_message(problems: list[tuple[str, str]]) -> str:
    return f"{' · '.join(text for _, text in problems)}. 확인해 주세요."


# ───────────────────────── 전화 (phone.ts) ─────────────────────────

_PHONE_PREFIXES = ("010", "011", "016", "017", "018", "019")


def normalize_phone(value: Any) -> str:
    """카톡 표기 → '010-1234-5678'. 휴대폰 형식이 아니면 ''."""
    digits = re.sub(r"\D", "", str(value or "").strip())
    if not digits:
        return ""
    if len(digits) in (7, 8):
        digits = f"010{digits}"
    elif len(digits) == 10 and digits.startswith("10"):
        digits = f"0{digits}"
    if not 10 <= len(digits) <= 11:
        return ""
    prefix = next((p for p in _PHONE_PREFIXES if digits.startswith(p)), "")
    if not prefix:
        prefix = digits[:3] if digits.startswith("0") else digits[:4]
    rest = digits[len(prefix):][:8]
    if len(rest) <= 4:
        mid, last = rest, ""
    elif len(rest) <= 7:
        mid, last = rest[:-4], rest[-4:]
    else:
        mid, last = rest[:4], rest[4:8]
    if len(mid) < 3 or len(last) != 4:
        return ""
    return f"{prefix}-{mid}-{last}"


# ───────────────────────── 상품 (matchFarmProduct.ts) ─────────────────────────

_VARIETY_GROUPS = [
    ["포도", "캠벨", "거봉", "샤인", "샤인머스켓", "머스켓", "델라웨어", "흑포도", "청포도", "씨없는포도", "못난이포도"],
    ["사과", "부사", "홍로", "아오리", "감홍", "시나노", "시나노골드", "양광", "쓰가루"],
    ["배", "신고", "원황", "황금배", "추황"],
    ["감", "대봉", "반시", "곶감", "단감"],
    ["귤", "감귤", "한라봉", "천혜향", "레드향", "황금향"],
    ["토마토", "방울토마토", "대추방울"],
    ["딸기", "설향", "금실", "킹스베리"],
]
_WEIGHT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|㎏|키로)", re.I)
_JUICE = re.compile(r"즙|주스|juice")


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value).lower()


def _weights(value: str) -> list[str]:
    return [f"{m.group(1)}kg".lower() for m in _WEIGHT_RE.finditer(value)]


def _tokens(value: str) -> list[str]:
    compact = _compact(_squash(_WEIGHT_RE.sub(" ", value)))
    if not compact:
        return []
    parts = [p for p in re.split(r"[^0-9a-z가-힣]+", compact) if p]
    return parts or [compact]


def _variety(token: str) -> int:
    t = token.lower()
    return next((i for i, group in enumerate(_VARIETY_GROUPS)
                 if any(t == item or item in t or t in item for item in group)), -1)


def _related(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    ga = _variety(a)
    return ga >= 0 and ga == _variety(b)


def product_score(query: str, name: str) -> int:
    q, n = _compact(query), _compact(name)
    if not q or not n:
        return 0
    qw, nw = _weights(query), _weights(name)
    if qw and nw and not any(w in nw for w in qw):
        return 0
    if bool(_JUICE.search(q)) != bool(_JUICE.search(n)):
        return 0
    score = 4 if qw and any(w in qw for w in nw) else 0
    q_tokens, n_tokens = _tokens(query), _tokens(name)
    related = sum(1 for qt in q_tokens if any(_related(qt, nt) for nt in n_tokens))
    if related == 0 and q_tokens:
        return score if qw and nw else 0
    score += related * 3
    if q in n or n in q:
        score += 2
    return score


def _pick_ranked(query: str, products: list[dict]) -> dict | None:
    ranked = sorted(((p, product_score(query, p["name"])) for p in products), key=lambda r: -r[1])
    ranked = [r for r in ranked if r[1] > 0]
    if not ranked:
        return None
    if len(ranked) == 1 or ranked[0][1] > ranked[1][1]:
        return ranked[0][0]
    return None


def match_farm_product(query: str, catalog: list[dict]) -> dict | None:
    """정확히 1건으로 좁혀질 때만 돌려준다. catalog 는 판매 중 상품만."""
    q = query.strip()
    if not q or not catalog:
        return None
    qc = _compact(q)
    exact = [p for p in catalog if p["name"].strip() == q or _compact(p["name"]) == qc]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        return None
    contains = [p for p in catalog if _compact(p["name"]) and (qc in _compact(p["name"]) or _compact(p["name"]) in qc)]
    if len(contains) == 1:
        return contains[0]
    if len(contains) > 1:
        return _pick_ranked(q, contains)
    return _pick_ranked(q, catalog)


def product_candidates(query: str, catalog: list[dict], limit: int = 10) -> list[dict]:
    """미매칭일 때 보여 줄 후보 — 점수 있는 것 먼저, 없으면 판매 중 상품 전부(최대 limit)."""
    scored = sorted(((p, product_score(query, p["name"])) for p in catalog), key=lambda r: -r[1])
    hits = [p for p, s in scored if s > 0]
    rows = hits if len(hits) >= 2 else (hits + [p for p in catalog if p not in hits])
    return [{"id": p["id"], "name": p["name"], "unit": p.get("unit") or "", "price": int(p.get("price") or 0)}
            for p in rows[:limit]]


# ───────────────────────── 원문 위치 (OrderCreate.tsx) ─────────────────────────

def _recover_slice(haystack: str, needle: str) -> tuple[int, int] | None:
    trimmed = (needle or "").strip()
    if not trimmed or not haystack:
        return None
    at = haystack.find(trimmed)
    if at >= 0:
        return at, at + len(trimmed)
    compact_needle = re.sub(r"\s+", "", trimmed)
    index = [i for i, ch in enumerate(haystack) if not ch.isspace()]
    at = re.sub(r"\s+", "", haystack).find(compact_needle)
    if at < 0 or not compact_needle:
        return None
    return index[at], index[at + len(compact_needle) - 1] + 1


def find_address_span_text(raw: str, address: str, detail: str) -> str:
    """원문에서 기본주소 시작부터 상세주소 끝까지(줄바꿈·쉼표 포함) 그대로."""
    base = _recover_slice(raw, address)
    if not base:
        return ""
    end = base[1]
    if detail.strip():
        rest = raw[base[1]:]
        hit = _recover_slice(rest, detail)
        if hit and re.fullmatch(r"[\s,]*", rest[:hit[0]]):
            end = base[1] + hit[1]
    return raw[base[0]:end]


# ───────────────────────── 주소 확정 표시 ─────────────────────────
# 우체국으로 확정한 주소는 서명을 붙여 둔다. 다시 검수할 때 서명이 맞으면 우체국을 다시 찾지 않고
# 동·호만 본다 — 같은 건물이 단지명만 달리 여러 줄로 오는 주소는 다시 찾으면 또 다건이 되기 때문이다.

def address_token(secret: str, zonecode: str, address: str) -> str:
    message = f"farm-order-address:v1|{zonecode.strip()}|{_squash(address)}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()[:32]


def address_token_ok(secret: str, zonecode: str, address: str, token: str) -> bool:
    if not token or not zonecode or not address:
        return False
    return hmac.compare_digest(address_token(secret, zonecode, address), str(token))


# ───────────────────────── 외부 조회 캐시 ─────────────────────────

class TtlCache:
    """같은 검색어·건물은 잠시 다시 묻지 않는다 (챗봇이 같은 주문을 여러 번 재검수한다)."""

    def __init__(self, seconds: int = 600, size: int = 500):
        self.seconds, self.size = seconds, size
        self._rows: dict[str, tuple[float, Any]] = {}

    async def get(self, key: str, load: Callable[[], Awaitable[Any]]) -> Any:
        now = time.monotonic()
        hit = self._rows.get(key)
        if hit and now - hit[0] < self.seconds:
            return hit[1]
        value = await load()  # 실패는 캐시하지 않는다
        if len(self._rows) >= self.size:
            self._rows.pop(next(iter(self._rows)))
        self._rows[key] = (now, value)
        return value


EPOST_CACHE = TtlCache()
JUSO_CACHE = TtlCache()


# ───────────────────────── 주소 검수 ─────────────────────────

Search = Callable[[str], Awaitable[list[dict]]]
Lookup = Callable[[str, str], Awaitable[dict]]


def _road_base(address: str) -> str:
    return re.split(r"\s*\(", address.strip(), maxsplit=1)[0].strip()


async def check_address_detail(lookup: Lookup, road_address: str, detail: str) -> list[tuple[str, str]]:
    """확정된 도로명주소 + 상세로 동·호 문제를 찾는다. 건물 조회가 안 되면 표기로 추정한다."""
    dong, ho = parse_dong_ho(detail)
    road = _road_base(road_address)
    try:
        key = _WS.sub("", road) + "|" + _unit_key(dong, "동")
        info = await JUSO_CACHE.get(key,
                                    lambda: lookup(road, dong))
        if info.get("found"):
            return judge_address_detail(info, dong, ho)
    except Exception:  # noqa: BLE001 — 조회 실패는 추정으로 대신한다 (화면과 같다)
        pass
    if ho:
        return []
    if dong or _MULTI_UNIT_HINT.search(f"{road_address} {detail}"):
        return [("MISSING_HO", "공동주택으로 보이는데 호수가 없습니다")]
    return []


async def search_epost(search: Search, query: str) -> list[dict]:
    return await EPOST_CACHE.get(query, lambda: search(query))


def apply_address_selection(fields: dict, selected: dict, detail_input: str = "") -> dict:
    """우체국 후보를 주문에 넣는다. 상세가 없으면 원문에서 동·호를 건진다 (applyAddressSelection)."""
    road = selected.get("roadAddress", "")
    detail = (detail_input.strip()
              or extract_address_detail(fields.get("address", ""), road)
              or extract_address_detail(" ".join(x for x in (fields.get("address"), fields.get("addressDetail")) if x), road)
              or extract_address_detail(fields.get("addressRaw", ""), road))
    return {**fields, "address": road, "addressDetail": detail, "zonecode": selected.get("zipNo", "")}


async def review_address(fields: dict, *, search: Search, lookup: Lookup, secret: str,
                         fallback: bool = True) -> dict:
    """
    주문 하나의 주소를 검수한다. 돌려주는 것:
      fields       확정됐으면 도로명·우편번호·상세·addressToken 이 채워진 값
      status       ok | needs_address_select | needs_address_fix
      errors       [{field:'address', code, message}]
      candidates   우체국 후보 (선택이 필요하거나, 확정 후보로 동·호만 고칠 때 1건)
      searchQuery  후보를 만든 검색어
    """
    def result(status: str, out_fields: dict, errors=(), candidates=(), query=""):
        return {"status": status, "fields": out_fields, "candidates": list(candidates),
                "searchQuery": query,
                "errors": [{"field": "address", "code": c, "message": m} for c, m in errors]}

    # 이미 확정한 주소 — 동·호만 다시 본다.
    if address_token_ok(secret, fields.get("zonecode", ""), fields.get("address", ""), fields.get("addressToken", "")):
        problems = await check_address_detail(lookup, fields["address"], fields.get("addressDetail", ""))
        if not problems:
            return result("ok", fields)
        confirmed = {"id": f"epost:{fields['zonecode']}:{fields['address']}:", "zipNo": fields["zonecode"],
                     "roadAddress": fields["address"], "jibunAddress": ""}
        return result("needs_address_fix", fields, [(c, f"{m}. 확인해 주세요.") for c, m in problems],
                      [confirmed], build_epost_search_query(fields["address"]))

    # 확정 전 — 우편번호·서명을 지운 상태로 판정한다.
    draft = {**fields, "zonecode": "", "addressToken": ""}
    probe_base = draft.get("address", "").strip()
    probe_full = (draft.get("addressRaw") or " ".join(
        x for x in (draft.get("address"), draft.get("addressDetail")) if x)).strip()
    probe = probe_base or probe_full
    if len(probe) < 2:
        return result("needs_address_fix", draft, [("REQUIRED", "주소가 비어 있습니다.")])

    queries = list(dict.fromkeys(
        q for q in (_squash(build_epost_search_query(probe)), _squash(probe_base)) if len(q) >= 2))
    last_count, last_error, mismatched = 0, None, None
    for query in queries:
        try:
            results = await search_epost(search, query)
        except Exception as error:  # noqa: BLE001
            last_error = str(error) or "우체국 주소 조회에 실패했습니다."
            continue
        last_count = len(results)
        search_query = build_epost_search_query(query) or query
        unique = resolve_unique_epost_match(probe_base or probe_full, results) \
            or resolve_unique_epost_match(probe_full, results)
        if unique:
            resolved = apply_address_selection(draft, unique, draft.get("addressDetail", ""))
            resolved["addressToken"] = address_token(secret, resolved["zonecode"], resolved["address"])
            problems = await check_address_detail(lookup, resolved["address"], resolved["addressDetail"])
            if not problems:
                return result("ok", resolved)
            # 기본주소는 확정됐고 동·호만 확인받는다. 확정 후보를 그대로 남긴다.
            return result("needs_address_fix", resolved, [(c, f"{m}. 확인해 주세요.") for c, m in problems],
                          [unique], search_query)
        # 다건이면 바로 사용자 선택 — 다른 검색어로 우연히 1건이 나와도 오확정 위험이 있어 멈춘다.
        if len(results) > 1 and mismatched:
            break
        if len(results) > 1:
            return result("needs_address_select", draft,
                          [("MULTI_CANDIDATES", "주소가 여러 건 검색됩니다. 확인해 주세요.")], results, search_query)
        if len(results) == 1 and not mismatched:
            mismatched = (results, search_query)

    if mismatched:
        district = find_district_mismatch(probe, mismatched[0][0])
        if district:
            error = ("DISTRICT_MISMATCH", f"확인 필요 · 원문은 {district[0]}인데 우체국 주소는 {district[1]}입니다.")
        else:
            error = ("ADDRESS_MISMATCH", "검색 결과가 원문 주소와 일치하지 않습니다. 확인해 주세요.")
        return result("needs_address_select", draft, [error], mismatched[0], mismatched[1])
    if last_error and last_count == 0:
        return result("needs_address_fix", draft, [("SEARCH_FAILED", last_error)])

    # 원문 검색어로 0건 — 시·군·구가 바뀐 주소일 수 있어 도로명+번호로 다시 찾아 후보로만 보여 준다.
    if fallback:
        for query in build_epost_fallback_queries(probe):
            if query in queries:
                continue
            try:
                results = await search_epost(search, query)
            except Exception:  # noqa: BLE001
                continue
            if results:
                return result("needs_address_select", draft,
                              [("FALLBACK_CANDIDATES",
                                "원문 주소로는 검색되지 않습니다. 비슷한 주소 중에서 골라 주세요.")],
                              results[:20], query)
    return result("needs_address_fix", draft, [("NOT_FOUND", "우체국에서 검색되지 않는 주소입니다.")])


async def gather_limited(coros: list[Awaitable], limit: int = 5) -> list:
    gate = asyncio.Semaphore(limit)

    async def run(coro):
        async with gate:
            return await coro

    return await asyncio.gather(*(run(c) for c in coros))
