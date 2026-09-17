import { LayoutDashboard, Package, Truck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FarmOrderPageLink } from '../../components/layout/FarmOrderPageLink'
import { Header } from '../../components/layout/Header'
import { NotificationBell } from '../../components/notifications/NotificationBell'
import {
  MonthlyOrderTrendCard,
  ProductSalesShareCard,
  RevenueAnalysisCard,
} from '../../components/shared/DashboardAnalytics'
import { StatCard } from '../../components/ui/StatCard'
import { useAuth } from '../../lib/auth'
import { demoDashboardOrders } from '../../lib/demoDashboardOrders'
import { loadDemoFarmOrders } from '../../lib/demoFarmOrders'
import { useFarmWorkspace } from '../../lib/farmWorkspace'
import { farmDisplayLocation, formatDate, formatPrice } from '../../lib/format'
import type { OrderRow } from '../../lib/orders'
import { supabase } from '../../lib/supabase'

export function FarmDashboard() {
  const { farm, basePath, isAdminView } = useFarmWorkspace()
  const { signOut } = useAuth()
  const [dbOrders, setDbOrders] = useState<OrderRow[]>([])
  const [demoOrders, setDemoOrders] = useState<OrderRow[]>(() => loadDemoFarmOrders(farm.id))

  useEffect(() => {
    setDemoOrders(loadDemoFarmOrders(farm.id))
    supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('farm_id', farm.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setDbOrders((data as OrderRow[]) ?? []))
  }, [farm.id])

  const liveOrders = useMemo(() => {
    const dbIds = new Set(dbOrders.map((row) => row.id))
    return [...demoOrders.filter((row) => !dbIds.has(row.id)), ...dbOrders]
  }, [demoOrders, dbOrders])

  // 실제·직접추가 주문이 없으면 대시보드용 더미로 채운다(주문 목록과는 분리).
  const orders = useMemo(
    () => (liveOrders.length > 0 ? liveOrders : demoDashboardOrders(farm.id)),
    [liveOrders, farm.id],
  )

  const today = new Date().toDateString()
  const todayOrders = orders.filter((o) => new Date(o.created_at).toDateString() === today).length
  const pendingDelivery = orders.filter((o) => o.status === 'paid' || o.status === 'packing').length
  const monthRevenue = orders
    .filter((o) => o.status !== 'cancelled' && o.status !== 'pending_deposit')
    .filter((o) => {
      const d = new Date(o.created_at)
      const now = new Date()
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    .reduce((sum, o) => sum + o.total_amount, 0)

  return (
    <>
      <Header
        title={farm.name}
        subtitle={farmDisplayLocation(farm) || formatDate(farm.created_at)}
        rightElement={
          <>
            <FarmOrderPageLink slug={farm.slug} />
            {!isAdminView && (
              <button type="button" className="text-sm text-muted" onClick={() => void signOut()}>
                로그아웃
              </button>
            )}
            <NotificationBell farmPath={`${basePath}/orders`} />
          </>
        }
      />
      <div className="px-4 py-4 md:px-6 max-w-5xl mx-auto space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="오늘 주문"
            value={`${todayOrders}건`}
            icon={Package}
            to={`${basePath}/orders`}
          />
          <StatCard
            label="출고 대기"
            value={`${pendingDelivery}건`}
            icon={Truck}
            to={`${basePath}/delivery`}
          />
          <StatCard
            label="이번 달 매출"
            value={formatPrice(monthRevenue)}
            icon={LayoutDashboard}
            to={`${basePath}/orders`}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <MonthlyOrderTrendCard orders={orders} />
          <ProductSalesShareCard orders={orders} />
        </div>
        <RevenueAnalysisCard orders={orders} />
      </div>
    </>
  )
}
