import { invokeFunction } from './functions'
import type { OrderStatus } from '../types/models'

/**
 * 주문 상태를 바꾼 뒤 손님에게 알림톡을 보낸다 (서버 RPC notify-alimtalk).
 *
 * - 배송완료(completed) → 배송완료 안내
 * - 택배번호(배송시작) 안내는 여기서 보내지 않는다. 송장을 직접 등록하면 서버가 Delivery Tracker 로
 *   택배사 접수를 확인한 뒤 보낸다 (shared/shipping_tracking.py). 상태만 바꿔서는 나가지 않는다.
 * - 입금완료(paid) → 주문완료 안내. 입금 확인 경로에서 이미 보냈으면 서버가 다시 보내지 않는다.
 *
 * 발송 실패가 상태 변경을 막지 않도록 기다리지 않고 콘솔에만 남긴다.
 */
const KIND_BY_STATUS: Partial<Record<OrderStatus, 'delivered' | 'order_done'>> = {
  completed: 'delivered',
  paid: 'order_done',
}

export function notifyOrderStatusAlimtalk(orderId: string, status: OrderStatus) {
  const kind = KIND_BY_STATUS[status]
  if (!kind) return
  void invokeFunction('notify-alimtalk', { kind, orderId }).catch((error) => {
    console.warn('알림톡 발송 요청 실패', error)
  })
}

/** 연락처를 처음 저장한 사용자에게 회원가입 알림톡. 번호는 서버가 프로필에서 읽는다. */
export function notifySignupAlimtalk() {
  void invokeFunction('notify-alimtalk', { kind: 'signup' }).catch((error) => {
    console.warn('알림톡 발송 요청 실패', error)
  })
}
