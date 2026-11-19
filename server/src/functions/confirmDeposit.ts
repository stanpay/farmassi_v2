import { sb } from '../sb.ts'
import { notifyFarmMembers } from '../shared/push.ts'
import { isAdmin, isFarmMember } from '../shared/util.ts'
import { fail, ok, type FnHandler } from './types.ts'

export const confirmDeposit: FnHandler = async ({ userId, body, admin }) => {
  if (!userId) return fail('로그인이 필요합니다.', 401)
  if (!body?.orderId) return fail('orderId가 필요합니다.')

  const db = sb(admin)
  const provider = body.provider ?? 'manual'
  const { data: order } = await db.from('orders').select('*').eq('id', body.orderId).maybeSingle()
  if (!order) return fail('주문을 찾을 수 없습니다.', 404)
  if (order.status !== 'pending_deposit') return fail('입금 대기 주문이 아닙니다.')

  const allowed =
    (await isAdmin(admin, userId)) ||
    (await isFarmMember(admin, userId, order.farm_id))
  if (!allowed) return fail('이 주문의 입금을 확인할 권한이 없습니다.', 403)

  const { error: updateError } = await db.from('orders').update({
    status: 'paid',
    deposit_confirmed_at: new Date().toISOString(),
    deposit_confirmed_by: userId,
    deposit_provider: provider,
  }).eq('id', order.id)
  if (updateError) return fail(updateError.message)

  await db.from('deposit_transactions').insert({
    farm_id: order.farm_id,
    provider,
    occurred_at: new Date().toISOString(),
    amount: order.deposit_due_amount,
    depositor_name: order.deposit_code,
    raw_payload: { source: 'confirm-deposit', by: userId },
    matched_order_id: order.id,
    match_status: 'matched',
  })

  await notifyFarmMembers(admin, {
    farmId: order.farm_id,
    orderId: order.id,
    type: 'deposit_confirmed',
    title: '입금 확인됨, 출고 준비',
    body: `${order.order_no} 입금이 확인되었습니다. 포장을 시작해주세요.`,
  })

  return ok()
}
