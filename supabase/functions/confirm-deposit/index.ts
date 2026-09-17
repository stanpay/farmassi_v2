import { adminClient, corsHeaders, getUserFromRequest, isAdmin, isFarmMember, json } from '../_shared/http.ts'
import { notifyFarmMembers } from '../_shared/push.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const user = await getUserFromRequest(req)
  if (!user) return json({ error: '로그인이 필요합니다.' }, 401)

  const admin = adminClient()
  const body = (await req.json()) as { orderId?: string; provider?: string }
  if (!body.orderId) return json({ error: 'orderId가 필요합니다.' }, 400)

  const provider = body.provider ?? 'manual'
  const { data: order } = await admin.from('orders').select('*').eq('id', body.orderId).maybeSingle()
  if (!order) return json({ error: '주문을 찾을 수 없습니다.' }, 404)
  if (order.status !== 'pending_deposit') return json({ error: '입금 대기 주문이 아닙니다.' }, 400)

  const allowed =
    (await isAdmin(admin, user.id)) ||
    (await isFarmMember(admin, user.id, order.farm_id as string))
  if (!allowed) return json({ error: '이 주문의 입금을 확인할 권한이 없습니다.' }, 403)

  const { error: updateError } = await admin
    .from('orders')
    .update({
      status: 'paid',
      deposit_confirmed_at: new Date().toISOString(),
      deposit_confirmed_by: user.id,
      deposit_provider: provider,
    })
    .eq('id', order.id)

  if (updateError) return json({ error: updateError.message }, 400)

  await admin.from('deposit_transactions').insert({
    farm_id: order.farm_id,
    provider,
    occurred_at: new Date().toISOString(),
    amount: order.deposit_due_amount,
    depositor_name: order.deposit_code,
    raw_payload: { source: 'confirm-deposit', by: user.id },
    matched_order_id: order.id,
    match_status: 'matched',
  })

  await notifyFarmMembers(admin, {
    farmId: order.farm_id as string,
    orderId: order.id as string,
    type: 'deposit_confirmed',
    title: '입금 확인됨, 출고 준비',
    body: `${order.order_no} 입금이 확인되었습니다. 포장을 시작해주세요.`,
  })

  return json({ ok: true })
})
