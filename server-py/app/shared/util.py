import secrets
from datetime import datetime, timedelta, timezone

import asyncpg

from ..sb import sb

_KST = timezone(timedelta(hours=9))


def random_code(length: int) -> str:
    """헷갈리는 글자(0/O, 1/I)를 뺀 코드. 입금자명으로 사람이 옮겨 적기 때문이다."""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(chars) for _ in range(length))


#: 플랫폼 관리자(슈퍼어드민)로 보는 역할. DB 의 private.is_admin() 과 같아야 한다.
#: 전환 기간(doc/admin-roles/sql/02~05)에는 옛 'admin' 도 받는다.
#: 일반 어드민은 역할이 아니라 farm_members(농가 연결)로 판단한다 — is_farm_member.
ADMIN_ROLES = ("admin", "super_admin")


async def is_admin(conn: asyncpg.Connection, user_id: str) -> bool:
    """슈퍼어드민인가 (플랫폼 전체 + 모든 농가)."""
    result = await sb(conn).from_("profiles").select("role").eq("id", user_id).maybe_single()
    return bool(result.data) and result.data.get("role") in ADMIN_ROLES


async def is_farm_member(conn: asyncpg.Connection, user_id: str, farm_id: str) -> bool:
    result = (
        await sb(conn)
        .from_("farm_members")
        .select("farm_id")
        .eq("farm_id", farm_id)
        .eq("user_id", user_id)
        .maybe_single()
    )
    return bool(result.data)


def seoul_date_compact(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(_KST).strftime("%Y%m%d")


def now_iso() -> str:
    """Node 의 new Date().toISOString() 과 같은 형식 — 밀리초 3자리 + 'Z'."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
