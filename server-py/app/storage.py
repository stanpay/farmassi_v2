"""
Supabase Storage 대체.

원래 정책: 경로의 첫 폴더가 farm_id 이고, 그 농가의 구성원만 쓸 수 있다.
여기서도 같은 규칙을 적용한다.
"""
import os
import posixpath
import re
from pathlib import Path

import asyncpg

from .config import config
from .sb import sb
from .shared.util import is_admin

MAX_BYTES = 5 * 1024 * 1024
ALLOWED = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MIME = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def safe_path(raw: str) -> str:
    """상위 디렉터리로 빠져나가는 경로를 막는다."""
    cleaned = posixpath.normpath(raw)
    cleaned = re.sub(r"^(\.\.(/|$))+", "", cleaned)
    if cleaned.startswith("/") or ".." in cleaned:
        raise Exception("경로가 올바르지 않습니다.")
    return cleaned


async def _is_farm_member(conn: asyncpg.Connection, user_id: str, farm_id: str) -> bool:
    client = sb(conn)
    member = (await client.from_("farm_members").select("farm_id")
              .eq("farm_id", farm_id).eq("user_id", user_id).maybe_single()).data
    if member:
        return True
    # 슈퍼어드민은 연결 없이도 모든 농가에 올린다. 판단은 한 곳(util.is_admin)에서만.
    return await is_admin(conn, user_id)


async def upload_image(
    conn: asyncpg.Connection, user_id: str | None, path: str, content_type: str, data: bytes
) -> dict[str, str]:
    if not user_id:
        raise Exception("로그인이 필요합니다.")

    # 프론트가 정한 경로를 그대로 쓴다. 단 첫 폴더는 반드시 농가 id 여야 하고,
    # 그 농가의 구성원만 쓸 수 있다. Supabase Storage 정책과 같은 규칙이다.
    safe = safe_path(path)
    farm_id = safe.split("/")[0]
    if not UUID.match(farm_id):
        raise Exception("경로의 첫 폴더는 농가 식별자여야 합니다.")
    if not await _is_farm_member(conn, user_id, farm_id):
        raise Exception("이 농가에 업로드할 권한이 없습니다.")

    ext = ALLOWED.get(content_type)
    if not ext:
        raise Exception("jpg, png, webp, gif 만 올릴 수 있습니다.")
    actual = posixpath.splitext(safe)[1].lower()
    if actual != ext and not (ext == ".jpg" and actual == ".jpeg"):
        raise Exception("확장자와 파일 형식이 다릅니다.")
    if not data:
        raise Exception("빈 파일입니다.")
    if len(data) > MAX_BYTES:
        raise Exception("5MB 이하만 올릴 수 있습니다.")

    full = Path(config.upload_dir) / safe
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)

    return {"url": f"{config.public_upload_base}/{safe}", "path": safe}


async def delete_image(conn: asyncpg.Connection, user_id: str | None, path: str) -> None:
    if not user_id:
        raise Exception("로그인이 필요합니다.")
    safe = safe_path(path)
    farm_id = safe.split("/")[0]
    if not UUID.match(farm_id):
        raise Exception("경로가 올바르지 않습니다.")
    if not await _is_farm_member(conn, user_id, farm_id):
        raise Exception("삭제 권한이 없습니다.")
    try:
        os.unlink(Path(config.upload_dir) / safe)
    except OSError:
        pass


def resolve_file(path: str) -> tuple[Path, str] | None:
    """업로드된 파일의 실제 경로와 MIME 을 돌려준다. 없으면 None."""
    try:
        full = Path(config.upload_dir) / safe_path(path)
    except Exception:  # noqa: BLE001
        raise
    if not full.is_file():
        return None
    return full, MIME.get(full.suffix.lower(), "application/octet-stream")
