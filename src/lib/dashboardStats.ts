import { digitsOnly } from './phone'
import type { OrderRow } from './orders'

export function countableOrders(orders: OrderRow[]) {
  return orders.filter((order) => order.status !== 'cancelled')
}

/** 최근 n개월 주문 건수 (서울 기준 달). */
export function monthlyOrderCounts(orders: OrderRow[], months = 6) {
  const source = countableOrders(orders)
  const now = new Date()
  const buckets: { key: string; label: string; count: number; revenue: number }[] = []

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets.push({
      key,
      label: `${d.getFullYear()}년 ${d.getMonth() + 1}월`,
      count: 0,
      revenue: 0,
    })
  }

  const index = new Map(buckets.map((b, i) => [b.key, i]))
  for (const order of source) {
    const created = new Date(order.created_at)
    const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`
    const at = index.get(key)
    if (at === undefined) continue
    buckets[at].count += 1
    if (order.status !== 'pending_deposit') {
      buckets[at].revenue += order.total_amount ?? 0
    }
  }
  return buckets
}

/** 상품명별 판매 수량. */
export function productSalesShare(orders: OrderRow[], limit = 6) {
  const tally = new Map<string, number>()
  for (const order of countableOrders(orders)) {
    for (const item of order.order_items ?? []) {
      const name = item.product_name?.trim() || '상품'
      tally.set(name, (tally.get(name) ?? 0) + (item.quantity ?? 0))
    }
  }
  return [...tally.entries()]
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, limit)
}

/** 연락처 기준 신규/재구매 고객 수. */
export function repurchaseCustomerRatio(orders: OrderRow[]) {
  const byCustomer = new Map<string, number>()
  for (const order of countableOrders(orders)) {
    const phone = digitsOnly(order.recipient_phone ?? '')
    const key = phone || `name:${(order.recipient_name || '').trim() || order.id}`
    byCustomer.set(key, (byCustomer.get(key) ?? 0) + 1)
  }
  let returning = 0
  let neu = 0
  for (const count of byCustomer.values()) {
    if (count >= 2) returning += 1
    else neu += 1
  }
  const total = returning + neu
  return {
    newCustomers: neu,
    returningCustomers: returning,
    total,
    returningRate: total === 0 ? 0 : returning / total,
  }
}

export function revenueSummary(orders: OrderRow[]) {
  const paid = countableOrders(orders).filter((o) => o.status !== 'pending_deposit')
  const totalSales = paid.reduce((sum, o) => sum + (o.total_amount ?? 0), 0)
  const now = new Date()
  const monthSales = paid
    .filter((o) => {
      const d = new Date(o.created_at)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    .reduce((sum, o) => sum + (o.total_amount ?? 0), 0)
  const orderCount = paid.length
  const avgOrder = orderCount === 0 ? 0 : Math.round(totalSales / orderCount)
  return { totalSales, monthSales, orderCount, avgOrder }
}
