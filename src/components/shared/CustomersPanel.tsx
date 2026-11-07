import { ChevronDown, Plus, RefreshCw, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Header } from '../layout/Header'
import { RepurchaseRatioCard } from './DashboardAnalytics'
import { OrderItem } from './OrderItem'
import { SensitiveContent } from './SensitiveContent'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { formatDate, formatPrice } from '../../lib/format'
import { digitsOnly, formatPhone } from '../../lib/phone'
import {
  customerDisplayHash,
  maskPersonName,
  maskPhone,
} from '../../lib/privacy'
import { toOrderListModel, unwrapFarm, reorderCountsByOrderId, type OrderRow } from '../../lib/orders'
import { statusLabels } from '../../lib/orderStatus'

export interface CustomerRow {
  id: string
  hash: string
  name: string
  phone: string
  phoneDigits: string
  email: string
  orderCount: number
  totalAmount: number
  lastOrderedAt: string
  regular: boolean
  note: string
  farmNames: string[]
  orders: OrderRow[]
}

type SortId = 'name' | 'recent' | 'orders'

const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: 'name', label: '이름순' },
  { id: 'recent', label: '최근주문순' },
  { id: 'orders', label: '주문많은순' },
]

/** 연락처(없으면 이름)로 고객을 묶는다. PDF 고객관리 표와 같은 요약. */
export function customersFromOrders(orders: OrderRow[]): CustomerRow[] {
  const byKey = new Map<string, CustomerRow>()

  for (const order of orders) {
    const phoneDigits = digitsOnly(order.recipient_phone ?? '')
    const name = (order.recipient_name || '이름 없음').trim()
    const key = phoneDigits || `name:${name}`
    const farmName = unwrapFarm(order.farms).name
    const existing = byKey.get(key)

    if (!existing) {
      byKey.set(key, {
        id: key,
        hash: customerDisplayHash(key),
        name,
        phone: order.recipient_phone ? formatPhone(order.recipient_phone) : '',
        phoneDigits,
        email: '',
        orderCount: 1,
        totalAmount: order.total_amount ?? 0,
        lastOrderedAt: order.created_at,
        regular: false,
        note: order.request_memo?.trim() || '',
        farmNames: farmName && farmName !== '농가' ? [farmName] : [],
        orders: [order],
      })
      continue
    }

    existing.orderCount += 1
    existing.totalAmount += order.total_amount ?? 0
    existing.orders.push(order)
    if (order.created_at > existing.lastOrderedAt) {
      existing.lastOrderedAt = order.created_at
      if (order.request_memo?.trim()) existing.note = order.request_memo.trim()
      if (name && name !== '이름 없음') existing.name = name
      if (order.recipient_phone) existing.phone = formatPhone(order.recipient_phone)
    }
    if (farmName && farmName !== '농가' && !existing.farmNames.includes(farmName)) {
      existing.farmNames.push(farmName)
    }
  }

  return [...byKey.values()].map((row) => ({
    ...row,
    regular: row.orderCount >= 2,
    note: row.regular && !row.note ? '단골 고객' : row.note,
    orders: [...row.orders].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  }))
}

export function CustomersPanel({
  orders,
  loading,
  onRefresh,
  title = '고객 관리',
  showFarmColumn = false,
  toolbar,
}: {
  orders: OrderRow[]
  loading?: boolean
  onRefresh: () => void
  title?: string
  showFarmColumn?: boolean
  toolbar?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortId>('name')
  const [openId, setOpenId] = useState<string | null>(null)

  const customers = useMemo(() => customersFromOrders(orders), [orders])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? customers.filter((row) => {
          const hay = [
            row.hash,
            row.name,
            row.phone,
            row.phoneDigits,
            row.email,
            row.note,
            ...row.farmNames,
          ]
            .join(' ')
            .toLowerCase()
          return hay.includes(q) || (digitsOnly(q).length > 0 && row.phoneDigits.includes(digitsOnly(q)))
        })
      : customers

    return [...filtered].sort((a, b) => {
      if (sort === 'recent') return b.lastOrderedAt.localeCompare(a.lastOrderedAt)
      if (sort === 'orders') return b.orderCount - a.orderCount || a.name.localeCompare(b.name, 'ko')
      return a.name.localeCompare(b.name, 'ko')
    })
  }, [customers, query, sort])

  return (
    <>
      <Header title={title} subtitle={`고객 ${visible.length}명 · 주문 ${orders.length}건`} />
      <div className="px-4 py-4 md:px-6 max-w-6xl mx-auto space-y-4">
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => undefined}>
            <Plus className="h-4 w-4" />
            고객 추가
          </Button>
        </div>

        {toolbar}

        <RepurchaseRatioCard orders={orders} />

        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="해시, 고객명, 연락처로 검색..."
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </label>
          <select
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-primary"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortId)}
            aria-label="정렬"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={onRefresh}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </Button>
        </Card>

        {visible.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-12 text-center text-sm text-muted">
            {loading ? '불러오는 중…' : '표시할 고객이 없습니다'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-muted">
                    <th className="px-4 py-3 font-medium">해시</th>
                    <th className="px-4 py-3 font-medium">고객명</th>
                    <th className="px-4 py-3 font-medium">연락처</th>
                    {showFarmColumn && <th className="px-4 py-3 font-medium">농가</th>}
                    <th className="px-4 py-3 font-medium">누적주문</th>
                    <th className="px-4 py-3 font-medium">누적금액</th>
                    <th className="px-4 py-3 font-medium">최근주문일</th>
                    <th className="px-4 py-3 font-medium">단골</th>
                    <th className="px-4 py-3 font-medium">비고</th>
                    <th className="px-4 py-3 font-medium text-right">주문내역</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((customer) => {
                    const open = openId === customer.id
                    return (
                      <CustomerTableRows
                        key={customer.id}
                        customer={customer}
                        open={open}
                        showFarmColumn={showFarmColumn}
                        onToggle={() => setOpenId(open ? null : customer.id)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function CustomerTableRows({
  customer,
  open,
  showFarmColumn,
  onToggle,
}: {
  customer: CustomerRow
  open: boolean
  showFarmColumn: boolean
  onToggle: () => void
}) {
  const colSpan = showFarmColumn ? 10 : 9
  const reorderCounts = reorderCountsByOrderId(customer.orders)
  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50/80">
        <td className="px-4 py-3">
          <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">
            {customer.hash}
          </code>
        </td>
        <td className="px-4 py-3 align-middle">
          <SensitiveContent
            label="이름"
            preview={maskPersonName(customer.name)}
          >
            <span className="font-semibold text-gray-900">{customer.name}</span>
          </SensitiveContent>
        </td>
        <td className="px-4 py-3 align-middle text-gray-700">
          {customer.phone ? (
            <SensitiveContent label="연락처" preview={maskPhone(customer.phone)}>
              <a href={`tel:${customer.phoneDigits}`} className="hover:text-primary">
                {customer.phone}
              </a>
            </SensitiveContent>
          ) : (
            '—'
          )}
        </td>
        {showFarmColumn && (
          <td className="px-4 py-3 text-muted">
            {customer.farmNames.length > 0 ? customer.farmNames.join(', ') : '—'}
          </td>
        )}
        <td className="px-4 py-3 tabular-nums">{customer.orderCount}회</td>
        <td className="px-4 py-3 tabular-nums">{formatPrice(customer.totalAmount)}</td>
        <td className="px-4 py-3 whitespace-nowrap text-muted">{formatDate(customer.lastOrderedAt)}</td>
        <td className="px-4 py-3">
          {customer.regular ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              단골
            </span>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </td>
        <td className="max-w-[10rem] truncate px-4 py-3 text-muted" title={customer.note}>
          {customer.note || '—'}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-primary hover:bg-primary-light"
          >
            {open ? '접기' : '전체 보기'}
            <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-gray-100 bg-gray-50/50">
          <td colSpan={colSpan} className="px-4 py-4">
            <p className="mb-3 text-xs font-medium text-muted">
              <code className="mr-1.5 rounded bg-white px-1 py-0.5 font-mono text-[11px]">{customer.hash}</code>
              주문 내역 {customer.orders.length}건
              <span className="ml-2 font-normal">(이름·연락처·주소는 눌러서 확인)</span>
            </p>
            <div className="space-y-3">
              {customer.orders.map((order) => {
                const farmName = unwrapFarm(order.farms).name
                return (
                  <OrderItem
                    key={order.id}
                    maskSensitive
                    order={toOrderListModel(order, { reorderCount: reorderCounts.get(order.id) })}
                    extra={
                      <p className="mt-2 text-xs text-muted">
                        상태 {statusLabels[order.status] ?? order.status}
                        {farmName !== '농가' ? ` · ${farmName}` : ''}
                      </p>
                    }
                  />
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
