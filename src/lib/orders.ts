import type { Farm, Order, OrderItem, Shipment } from '../types/models'
import type { OrderListModel } from '../types/orderList'
import { formatDateTime, fullAddress } from './format'
import { digitsOnly } from './phone'

export type { OrderListModel } from '../types/orderList'
export type FarmJoin = Pick<Farm, 'name' | 'slug'>
export type OrderRow = Order & {
  order_items?: OrderItem[] | null
  shipments?: Shipment[] | null
  farms?: FarmJoin | FarmJoin[] | null
}

export function unwrapFarm(farm: OrderRow['farms']): FarmJoin {
  if (!farm) return { name: '농가', slug: 'farm' }
  return Array.isArray(farm) ? (farm[0] ?? { name: '농가', slug: 'farm' }) : farm
}

/** 송장 미발급(paid)을 발급 완료(packing)보다 앞에 둔다. 같은 상태면 최신순. */
export function sortShipmentOrders<T extends Pick<OrderRow, 'status' | 'created_at'>>(orders: T[]) {
  const rank = (status: string) => (status === 'paid' ? 0 : status === 'packing' ? 1 : 2)
  return [...orders].sort((a, b) => {
    const byStatus = rank(a.status) - rank(b.status)
    if (byStatus !== 0) return byStatus
    return b.created_at.localeCompare(a.created_at)
  })
}

export function groupOrdersByFarm<T extends OrderRow>(orders: T[]) {
  const map = new Map<string, { farmId: string; name: string; slug: string; orders: T[] }>()
  for (const order of sortShipmentOrders(orders)) {
    const farm = unwrapFarm(order.farms)
    const current = map.get(order.farm_id) ?? {
      farmId: order.farm_id,
      name: farm.name,
      slug: farm.slug,
      orders: [],
    }
    current.orders.push(order)
    map.set(order.farm_id, current)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

export function farmsFromOrders(orders: OrderRow[]) {
  return groupOrdersByFarm(orders).map(({ farmId, name, slug, orders: farmOrders }) => ({
    id: farmId,
    name,
    slug,
    count: farmOrders.length,
  }))
}

/**
 * 연락처별 주문 순번(1부터). 2 이상이면 재주문.
 * 취소 건은 제외한다.
 */
export function reorderCountsByOrderId(orders: OrderRow[]): Map<string, number> {
  const byPhone = new Map<string, OrderRow[]>()
  for (const order of orders) {
    if (order.status === 'cancelled') continue
    const phone = digitsOnly(order.recipient_phone ?? '')
    if (!phone) continue
    const list = byPhone.get(phone) ?? []
    list.push(order)
    byPhone.set(phone, list)
  }

  const counts = new Map<string, number>()
  for (const list of byPhone.values()) {
    const sorted = [...list].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    )
    sorted.forEach((order, index) => {
      counts.set(order.id, index + 1)
    })
  }
  return counts
}

export function toOrderListModel(
  order: OrderRow,
  opts?: { reorderCount?: number },
): OrderListModel {
  const items = order.order_items ?? []
  const reorderCount = opts?.reorderCount
  return {
    id: order.id,
    customerName: order.recipient_name,
    customerPhone: order.recipient_phone,
    productSummary: items.map((item) => `${item.product_name} ×${item.quantity}`).join(', ') || '상품',
    amount: order.total_amount,
    address: fullAddress(order.address, order.address_detail, order.zonecode),
    status: order.status,
    orderDate: formatDateTime(order.created_at),
    memo: order.request_memo,
    orderNo: order.order_no,
    trackingNumber: order.shipments?.[0]?.tracking_number,
    senderName: order.sender_name,
    senderPhone: order.sender_phone,
    senderAddress: order.sender_address
      ? fullAddress(order.sender_address, order.sender_address_detail, order.sender_zonecode)
      : null,
    senderAddressDetail: order.sender_address_detail,
    depositorName: order.depositor_name,
    // 배송비는 total_amount 에 이미 들어 있다. 빼서 상품 합계를 만든다.
    shippingFee: order.shipping_fee ?? 0,
    itemsAmount: order.total_amount - (order.shipping_fee ?? 0),
    depositDueAmount: order.deposit_due_amount,
    depositCode: order.deposit_code,
    reorderCount: reorderCount && reorderCount >= 2 ? reorderCount : undefined,
  }
}
