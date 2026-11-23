"""
알리고 카카오 알림톡 템플릿 관리 (관리자 전용).

브라우저에 API 키를 노출하지 않으려고 서버에서만 알리고를 부른다.
문서: https://smartsms.aligo.in/alimapi.html (템플릿관리)

카카오 규칙상 수정은 템플릿 상태가 대기(R)이고 검수상태가 등록(REG)·반려(REJ)일 때만
된다. 승인(APR)된 템플릿은 고칠 수 없어 새 템플릿을 만들어 다시 검수받아야 한다.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx

from ..shared.util import is_admin
from .types import FnCtx, FnResult, fail, ok

BASE_URL = "https://kakaoapi.aligo.in/akv10/template"

#: 화면에서 고를 수 있는 버튼 종류. 앱링크(AL)·봇키워드 등은 쓰지 않는다.
BUTTON_TYPES = {"WL", "AC", "DS", "MD", "BK"}
MAX_BUTTONS = 5
MAX_CONTENT = 1000
MAX_NAME = 30


class AligoError(Exception):
    pass


def _credentials() -> dict[str, str]:
    values = {
        "apikey": (os.environ.get("ALIGO_API_KEY") or "").strip(),
        "userid": (os.environ.get("ALIGO_USER_ID") or "").strip(),
        "senderkey": (os.environ.get("ALIGO_SENDER_KEY") or "").strip(),
    }
    missing = [name for name, key in (
        ("ALIGO_API_KEY", "apikey"), ("ALIGO_USER_ID", "userid"),
        ("ALIGO_SENDER_KEY", "senderkey")) if not values[key]]
    if missing:
        raise AligoError(f"{', '.join(missing)} 이(가) 설정되지 않았습니다.")
    return values


async def _call(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    data = {**_credentials(), **{k: v for k, v in (params or {}).items() if v is not None}}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(f"{BASE_URL}/{path}/", data=data)
    if response.status_code >= 400:
        raise AligoError(f"알리고 응답 오류 (HTTP {response.status_code})")
    try:
        parsed = response.json()
    except ValueError:
        raise AligoError(f"알리고 응답을 해석하지 못했습니다: {response.text[:200]}") from None
    # 템플릿 API 는 성공이면 code 0 이다.
    if str(parsed.get("code")) != "0":
        raise AligoError(str(parsed.get("message") or "알리고 요청이 실패했습니다."))
    return parsed


def _template(raw: dict[str, Any]) -> dict[str, Any]:
    code = str(raw.get("templtCode") or "")
    insp = str(raw.get("inspStatus") or "")
    status = str(raw.get("status") or "")
    return {
        "code": code,
        "name": raw.get("templtName") or "",
        "content": raw.get("templtContent") or "",
        "status": status,
        "inspStatus": insp,
        "createdAt": raw.get("cdate") or "",
        "comments": raw.get("comments") or [],
        "buttons": [{
            "name": b.get("name") or "",
            "linkType": b.get("linkType") or "",
            "linkMo": b.get("linkMo") or "",
            "linkPc": b.get("linkPc") or "",
        } for b in (raw.get("buttons") or [])],
        # 공유 템플릿(D·P 로 시작)은 우리 것이 아니라 손댈 수 없다.
        "shared": code[:1] in ("D", "P"),
        "editable": status == "R" and insp in ("REG", "REJ") and code[:1] not in ("D", "P"),
        "deletable": insp != "APR" and code[:1] not in ("D", "P"),
        "requestable": insp in ("REG", "REJ") and code[:1] not in ("D", "P"),
    }


def _clean_text(value: Any, label: str, limit: int) -> str:
    text = str(value or "").replace("\r\n", "\n").strip()
    if not text:
        raise AligoError(f"{label}을(를) 입력하세요.")
    if len(text) > limit:
        raise AligoError(f"{label}은(는) {limit}자 이하로 입력하세요.")
    return text


def _button_json(buttons: Any) -> str | None:
    """화면의 버튼 목록을 알리고 tpl_button 형식으로 바꾼다. 없으면 None."""
    if not buttons:
        return None
    if not isinstance(buttons, list) or len(buttons) > MAX_BUTTONS:
        raise AligoError(f"버튼은 최대 {MAX_BUTTONS}개입니다.")
    out = []
    for b in buttons:
        name = str((b or {}).get("name") or "").strip()
        link_type = str((b or {}).get("linkType") or "").strip().upper()
        if not name:
            raise AligoError("버튼 이름을 입력하세요.")
        if link_type not in BUTTON_TYPES:
            raise AligoError(f"지원하지 않는 버튼 종류입니다: {link_type or '(없음)'}")
        item = {"name": name, "linkType": link_type}
        if link_type == "WL":
            mo = str(b.get("linkMo") or "").strip()
            pc = str(b.get("linkPc") or "").strip() or mo
            if not mo.startswith(("http://", "https://")):
                raise AligoError(f"'{name}' 버튼의 링크는 http:// 또는 https:// 로 시작해야 합니다.")
            item.update({"linkM": mo, "linkP": pc})
        out.append(item)
    return json.dumps({"button": out}, ensure_ascii=False)


async def aligo_templates(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    if not await is_admin(ctx.admin, ctx.user_id):
        return fail("관리자만 사용할 수 있습니다.", 403)

    action = str(ctx.body.get("action") or "list")
    code = str(ctx.body.get("code") or "").strip()

    try:
        if action == "list":
            parsed = await _call("list")
            templates = [_template(t) for t in (parsed.get("list") or [])]
            return ok({"templates": templates, "info": parsed.get("info") or {}})

        if action in ("add", "modify"):
            params = {
                "tpl_name": _clean_text(ctx.body.get("name"), "템플릿 이름", MAX_NAME),
                "tpl_content": _clean_text(ctx.body.get("content"), "템플릿 내용", MAX_CONTENT),
                "tpl_button": _button_json(ctx.body.get("buttons")),
            }
            if action == "modify":
                if not code:
                    return fail("템플릿 코드가 필요합니다.")
                params["tpl_code"] = code
            parsed = await _call(action, params)
            data = parsed.get("data")
            return ok({"template": _template(data) if isinstance(data, dict) else None,
                       "message": parsed.get("message")})

        if action in ("delete", "request"):
            if not code:
                return fail("템플릿 코드가 필요합니다.")
            parsed = await _call("del" if action == "delete" else "request", {"tpl_code": code})
            return ok({"message": parsed.get("message")})

        return fail(f"알 수 없는 동작: {action}")
    except AligoError as error:
        return fail(str(error), 502)
    except httpx.HTTPError as error:
        return fail(f"알리고에 연결하지 못했습니다: {error}", 502)
