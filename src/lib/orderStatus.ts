import type { OrderStatus } from '../types/models'

export const statusLabels: Record<OrderStatus, string> = {
  pending_deposit: '입금대기',
  paid: '입금완료',
  packing: '송장 발급 완료',
  shipping: '배송중',
  completed: '배송완료',
  cancelled: '취소',
}

export const statusColors: Record<OrderStatus, string> = {
  pending_deposit: 'bg-gray-100 text-gray-700',
  paid: 'bg-blue-100 text-blue-700',
  packing: 'bg-amber-100 text-amber-700',
  shipping: 'bg-primary-light text-primary',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-600',
}

export const farmUpdatableStatuses: OrderStatus[] = [
  'pending_deposit',
  'paid',
  'packing',
  'shipping',
  'completed',
  'cancelled',
]
