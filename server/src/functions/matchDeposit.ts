import { sb } from '../sb.ts'
import { notifyFarmMembers } from '../shared/push.ts'
import { isAdmin, isFarmMember } from '../shared/util.ts'
import { fail, ok, type FnHandler } from './types.ts'

/**
 * 입금 내역을 주문에 손으로 붙이거나 떼어낸다.
 *
 * 자동 대사는 금액이 정확히 같아야 하고 입금자명이 다르면 붙이지 않는다.
 * "김철수" 로 주문했는데 "고길동" 이 입금한 경우가 그렇다. 그런 건을 사람이
 * 확인하고 연결할 수 있어야 한다.
 *
 * action:
 *   match   depositId + orderId  → 주문을 결제완료로, 입금을 matched 로
 *   unmatch depositId            → 연결을 끊고 주문을 다시 입금대기로
 *   ignore  depositId            → 주문과 무관한 입금으로 표시
 */
export const matchDeposit: FnHandler = async ({ userId, body, admin }) => {
  if (!userId) return fail('로그인이 필요합니다.', 401)

  const db = sb(admin)
  const action = String(body?.action ?? 'match')
  const depositId = String(body?.depositId ?? '')
  if (!depositId) return fail('depositId 가 필요합니다.')

  const { data: deposit } = await db.from('deposit_transactions')
    .select('*').eq('id', depositId).maybeSingle()
  if (!deposit) return fail('입금 내역을 찾을 수 없습니다.', 404)

  const adminUser = await isAdmin(admin, userId)
  async function canManageFarm(farmId: string | null | undefined) {
    if (adminUser) return true
    if (!farmId) return false
    return isFarmMember(admin, userId!, farmId)
  }

  if (action === 'ignore') {
    if (!(await canManageFarm(deposit.farm_id))) {
      return fail('이 입금을 처리할 권한이 없습니다.', 403)
    }
    await db.from('deposit_transactions')
      .update({ match_status: 'ignored', matched_order_id: null }).eq('id', depositId)
    return ok({ action, depositId })
  }

  if (action === 'unmatch') {
    if (!(await canManageFarm(deposit.farm_id))) {
      return fail('이 입금을 처리할 권한이 없습니다.', 403)
    }
    if (deposit.matched_order_id) {
      // 사람이 되돌리는 것이므로 주문도 입금대기로 돌린다.
      await db.from('orders').update({
        status: 'pending_deposit',
        deposit_confirmed_at: null,
        deposit_confirmed_by: null,
        deposit_provider: null,
      }).eq('id', deposit.matched_order_id).eq('status', 'paid')
    }
    await db.from('deposit_transactions')
      .update({ match_status: 'unmatched', matched_order_id: null }).eq('id', depositId)
    return ok({ action, depositId })
  }

  const orderId = String(body?.orderId ?? '')
  if (!orderId) return fail('연결할 주문을 선택하세요.')

  const { data: order } = await db.from('orders')
    .select('id, order_no, farm_id, status, deposit_due_amount').eq('id', orderId).maybeSingle()
  if (!order) return fail('주문을 찾을 수 없습니다.', 404)
  if (order.status !== 'pending_deposit') return fail('입금 대기 주문이 아닙니다.')

  if (!(await canManageFarm(order.farm_id))) {
    return fail('이 주문의 입금을 처리할 권한이 없습니다.', 403)
  }
  if (deposit.farm_id && deposit.farm_id !== order.farm_id && !adminUser) {
    return fail('다른 농가의 입금은 연결할 수 없습니다.', 403)
  }

  // 이미 다른 입금이 붙어 있는 주문인지 확인한다.
  const { data: already } = await db.from('deposit_transactions')
    .select('id').eq('matched_order_id', orderId).eq('match_status', 'matched').maybeSingle()
  if (already) return fail('이 주문에는 이미 다른 입금이 연결돼 있습니다.')

  const { data: updated } = await db.from('orders').update({
    status: 'paid',
    deposit_confirmed_at: new Date().toISOString(),
    deposit_confirmed_by: userId,
    deposit_provider: deposit.provider,
  }).eq('id', orderId).eq('status', 'pending_deposit').select('id, order_no, farm_id')

  const saved = (updated ?? [])[0]
  if (!saved) return fail('주문 상태를 바꾸지 못했습니다.')

  await db.from('deposit_transactions').update({
    matched_order_id: orderId,
    match_status: 'matched',
    farm_id: deposit.farm_id ?? saved.farm_id,
    raw_payload: { ...(deposit.raw_payload ?? {}), matched_by: userId, matched_manually: true },
  }).eq('id', depositId)

  await notifyFarmMembers(admin, {
    farmId: saved.farm_id,
    orderId: saved.id,
    type: 'deposit_confirmed',
    title: '입금 확인됨, 출고 준비',
    body: `${saved.order_no} 입금이 확인되었습니다. 포장을 시작해주세요.`,
  })

  return ok({
    action,
    depositId,
    orderNo: saved.order_no,
    amountMatches: Number(deposit.amount) === Number(order.deposit_due_amount),
  })
}
