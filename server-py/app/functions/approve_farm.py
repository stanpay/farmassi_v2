import re

from ..sb import sb
from ..shared.util import is_admin, now_iso, random_code
from .types import FnCtx, FnResult, fail, ok


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9가-힣-]", "", re.sub(r"\s+", "-", name.lower().strip()))
    return f"{base or 'farm'}-{random_code(6).lower()}"


async def approve_farm(ctx: FnCtx) -> FnResult:
    if not ctx.user_id:
        return fail("로그인이 필요합니다.", 401)
    if not await is_admin(ctx.admin, ctx.user_id):
        return fail("관리자만 처리할 수 있습니다.", 403)
    if not ctx.body.get("applicationId") or not ctx.body.get("action"):
        return fail("잘못된 요청입니다.")

    db = sb(ctx.admin)
    application = (await db.from_("farm_applications").select("*")
                   .eq("id", ctx.body["applicationId"]).maybe_single()).data
    if not application:
        return fail("신청을 찾을 수 없습니다.", 404)
    if application["status"] != "pending":
        return fail("이미 처리된 신청입니다.")

    review = {
        "review_note": ctx.body.get("reviewNote"),
        "reviewed_by": ctx.user_id,
        "reviewed_at": now_iso(),
    }

    if ctx.body["action"] == "reject":
        result = await db.from_("farm_applications").update(
            {"status": "rejected", **review}).eq("id", application["id"])
        if result.error:
            return fail(result.error["message"])
        return ok()

    farm_result = await db.from_("farms").insert({
        "slug": _slugify(application["farm_name"]),
        "name": application["farm_name"],
        "owner_user_id": application["user_id"],
        "location": application["location"],
        "product_summary": application["product_summary"],
        "description": application["description"],
        "bank_name": application["bank_name"],
        "account_number": application["account_number"],
        "account_holder": application["account_holder"],
        "is_active": True,
    }).select("id").single()
    if farm_result.error or not farm_result.data:
        return fail((farm_result.error or {}).get("message") or "농가 생성 실패")
    farm = farm_result.data

    member_result = await db.from_("farm_members").insert(
        {"farm_id": farm["id"], "user_id": application["user_id"], "member_role": "owner"})
    if member_result.error:
        # 연결이 거부되면(예: 일반 어드민은 농가 1곳 — doc/admin-roles/sql/07) 방금 만든 농가를 지운다.
        # 남겨 두면 연결 없는 농가가 생기고, 신청은 pending 이라 다시 누를 때마다 하나씩 더 쌓인다.
        await db.from_("farms").delete().eq("id", farm["id"])
        return fail(member_result.error["message"])

    await db.from_("farm_applications").update(
        {"status": "approved", **review, "farm_id": farm["id"]}).eq("id", application["id"])

    # Supabase 에서는 auth 사용자의 app_metadata 에 is_farm 을 찍었다. 로컬에서도 같은 자리에 남긴다.
    try:
        await ctx.admin.execute(
            "update auth.users set raw_app_meta_data = raw_app_meta_data ||"
            " '{\"is_farm\":true}'::jsonb where id = $1", application["user_id"])
    except Exception:  # noqa: BLE001
        pass

    return ok({"farmId": farm["id"]})
