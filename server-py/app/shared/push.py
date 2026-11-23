import json
import os
from typing import Any, Iterable

import asyncpg

from ..sb import sb


async def notify_farm_members(
    conn: asyncpg.Connection,
    *,
    farm_id: str,
    order_id: str,
    type_: str,
    title: str,
    body: str,
    url: str | None = None,
) -> None:
    client = sb(conn)
    members = (await client.from_("farm_members").select("user_id").eq("farm_id", farm_id)).data
    user_ids = list(dict.fromkeys(row["user_id"] for row in (members or [])))
    if not user_ids:
        return

    await client.from_("notifications").insert([
        {"user_id": uid, "farm_id": farm_id, "order_id": order_id,
         "type": type_, "title": title, "body": body}
        for uid in user_ids
    ])

    subs = (await client.from_("push_subscriptions")
            .select("endpoint, p256dh, auth").in_("user_id", user_ids)).data
    await send_push(subs or [], title=title, body=body,
                    url=url or f"/admin/farms/{farm_id}/orders")


async def notify_admins(
    conn: asyncpg.Connection, *, title: str, body: str, url: str | None = None
) -> None:
    """관리자 기기에 웹푸시. 구독한 관리자가 없으면 아무것도 하지 않는다."""
    subs = await conn.fetch(
        """select s.endpoint, s.p256dh, s.auth
             from public.push_subscriptions s
             join public.profiles p on p.id = s.user_id
            where p.role = 'admin'""")
    await send_push([dict(r) for r in subs], title=title, body=body, url=url)


async def send_push(
    subscriptions: Iterable[dict[str, Any]], *, title: str, body: str, url: str | None = None
) -> None:
    vapid_public = os.environ.get("VAPID_PUBLIC_KEY")
    vapid_private = os.environ.get("VAPID_PRIVATE_KEY")
    subscriptions = list(subscriptions)
    if not vapid_public or not vapid_private or not subscriptions:
        return

    try:
        import asyncio

        from pywebpush import webpush

        payload = json.dumps({"title": title, "body": body, "url": url})

        def one(sub: dict[str, Any]) -> None:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                },
                data=payload,
                vapid_private_key=vapid_private,
                vapid_claims={"sub": "mailto:hello@farmassi.kr"},
            )

        # pywebpush 는 동기라 이벤트 루프를 막지 않게 스레드로 돌린다.
        await asyncio.gather(
            *(asyncio.to_thread(one, sub) for sub in subscriptions), return_exceptions=True
        )
    except Exception as error:  # noqa: BLE001
        print("web-push 실패", error)
