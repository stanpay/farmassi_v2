import { Card } from '../ui/Card'
import { formatWon } from '../../lib/format'
import {
  monthlyOrderCounts,
  productSalesShare,
  repurchaseCustomerRatio,
  revenueSummary,
} from '../../lib/dashboardStats'
import type { OrderRow } from '../../lib/orders'

const BAR_COLORS = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
]

export function MonthlyOrderTrendCard({ orders }: { orders: OrderRow[] }) {
  const months = monthlyOrderCounts(orders, 6)
  const max = Math.max(...months.map((m) => m.count), 1)

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-bold text-gray-900">월별 주문 건수 추이</h3>
        <p className="mt-1 text-sm text-muted">최근 6개월</p>
      </div>
      <div className="flex h-40 items-end gap-2">
        {months.map((month) => (
          <div key={month.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-xs font-semibold tabular-nums text-gray-700">{month.count}</span>
            <div className="flex h-28 w-full items-end justify-center">
              <div
                className="w-full max-w-10 rounded-t-lg bg-primary/80"
                style={{ height: `${Math.max((month.count / max) * 100, month.count > 0 ? 8 : 0)}%` }}
                title={`${month.label} ${month.count}건`}
              />
            </div>
            <p className="truncate text-[10px] text-muted">{month.label.replace(/^\d+년 /, '')}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function ProductSalesShareCard({ orders }: { orders: OrderRow[] }) {
  const products = productSalesShare(orders)
  const max = Math.max(...products.map((p) => p.quantity), 1)

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-bold text-gray-900">상품별 판매 비중</h3>
        <p className="mt-1 text-sm text-muted">수량 기준</p>
      </div>
      {products.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">판매 데이터가 없습니다</p>
      ) : (
        <div className="flex h-40 items-end gap-3">
          {products.map((product, index) => (
            <div key={product.name} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-xs font-semibold tabular-nums text-gray-700">{product.quantity}</span>
              <div className="flex h-28 w-full items-end justify-center">
                <div
                  className={`w-full max-w-12 rounded-t-lg ${BAR_COLORS[index % BAR_COLORS.length]}`}
                  style={{ height: `${Math.max((product.quantity / max) * 100, 8)}%` }}
                  title={`${product.name} ${product.quantity}개`}
                />
              </div>
              <p className="w-full truncate text-center text-[10px] text-muted" title={product.name}>
                {product.name}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export function RevenueAnalysisCard({ orders }: { orders: OrderRow[] }) {
  const summary = revenueSummary(orders)
  const months = monthlyOrderCounts(orders, 6)
  const maxRevenue = Math.max(...months.map((m) => m.revenue), 1)

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-bold text-gray-900">수익 분석</h3>
        <p className="mt-1 text-sm text-muted">입금 완료된 주문 기준</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="총 매출" value={formatWon(summary.totalSales)} />
        <Metric label="이번 달 매출" value={formatWon(summary.monthSales)} accent />
        <Metric label="결제 주문" value={`${summary.orderCount}건`} />
        <Metric label="객단가" value={formatWon(summary.avgOrder)} />
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-muted">월별 매출</p>
        <div className="flex h-32 items-end gap-2">
          {months.map((month) => (
            <div key={month.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-24 w-full items-end justify-center">
                <div
                  className="w-full max-w-10 rounded-t-lg bg-emerald-500/80"
                  style={{
                    height: `${Math.max((month.revenue / maxRevenue) * 100, month.revenue > 0 ? 8 : 0)}%`,
                  }}
                  title={`${month.label} ${formatWon(month.revenue)}`}
                />
              </div>
              <p className="truncate text-[10px] text-muted">{month.label.replace(/^\d+년 /, '')}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

export function RepurchaseRatioCard({ orders }: { orders: OrderRow[] }) {
  const ratio = repurchaseCustomerRatio(orders)
  const returningPct = ratio.total === 0 ? 0 : Math.round(ratio.returningRate * 100)
  const newPct = ratio.total === 0 ? 0 : 100 - returningPct
  const gradient =
    ratio.total === 0
      ? 'conic-gradient(#e5e7eb 0 100%)'
      : `conic-gradient(#22c55e 0 ${returningPct}%, #f97316 ${returningPct}% 100%)`

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900">재구매 고객 비율</h3>
          <p className="mt-1 text-sm text-muted">2회 이상 주문한 고객</p>
        </div>
        <p className="text-2xl font-bold text-primary">{returningPct}%</p>
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <div
          className="relative h-28 w-28 shrink-0 rounded-full"
          style={{ background: gradient }}
          aria-hidden
        >
          <div className="absolute inset-4 flex items-center justify-center rounded-full bg-white text-center">
            <div>
              <p className="text-lg font-bold text-gray-900">{ratio.total}</p>
              <p className="text-[10px] text-muted">고객</p>
            </div>
          </div>
        </div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
            <span className="text-muted">신규 고객</span>
            <span className="font-semibold tabular-nums text-gray-900">
              {ratio.newCustomers}명 · {ratio.total === 0 ? 0 : newPct}%
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="text-muted">재구매 고객</span>
            <span className="font-semibold tabular-nums text-gray-900">
              {ratio.returningCustomers}명 · {returningPct}%
            </span>
          </li>
        </ul>
      </div>
    </Card>
  )
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${accent ? 'text-primary' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
