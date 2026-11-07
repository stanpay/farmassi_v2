import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FarmOrderPageLink } from '../../components/layout/FarmOrderPageLink'
import { Header } from '../../components/layout/Header'
import { NotificationBell } from '../../components/notifications/NotificationBell'
import { DepositConfirmExtra } from '../../components/shared/DepositConfirmExtra'
import { OrderItem } from '../../components/shared/OrderItem'
import { Button } from '../../components/ui/Button'
import { useFarmWorkspace } from '../../lib/farmWorkspace'
import {
  isDemoFarmOrderId,
  loadDemoFarmOrders,
  updateDemoFarmOrderStatus,
} from '../../lib/demoFarmOrders'
import { farmUpdatableStatuses, statusLabels } from '../../lib/orderStatus'
import { reorderCountsByOrderId, toOrderListModel, type OrderRow } from '../../lib/orders'
import { supabase } from '../../lib/supabase'
import type { OrderStatus } from '../../types/models'

type FilterStatus = 'all' | OrderStatus

const filters: { id: FilterStatus; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'pending_deposit', label: '입금대기' },
  { id: 'paid', label: '입금완료' },
  { id: 'packing', label: '송장 발급 완료' },
  { id: 'shipping', label: '배송중' },
  { id: 'completed', label: '배송완료' },
  { id: 'cancelled', label: '취소' },
]

export function FarmOrders() {
  const { farm, basePath } = useFarmWorkspace()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const statusParam = params.get('status')
  const [filter, setFilter] = useState<FilterStatus>(() =>
    statusParam && filters.some((f) => f.id === statusParam) ? (statusParam as FilterStatus) : 'all',
  )
  const [dbOrders, setDbOrders] = useState<OrderRow[]>([])
  const [demoOrders, setDemoOrders] = useState<OrderRow[]>(() => loadDemoFarmOrders(farm.id))

  useEffect(() => {
    if (statusParam && filters.some((f) => f.id === statusParam)) {
      setFilter(statusParam as FilterStatus)
    }
  }, [statusParam])

  useEffect(() => {
    setDemoOrders(loadDemoFarmOrders(farm.id))
  }, [farm.id, statusParam])

  useEffect(() => {
    supabase
      .from('orders')
      .select('*, order_items(*), shipments(*)')
      .eq('farm_id', farm.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setDbOrders((data as OrderRow[]) ?? []))
  }, [farm.id])

  const orders = useMemo(() => {
    const dbIds = new Set(dbOrders.map((row) => row.id))
    return [...demoOrders.filter((row) => !dbIds.has(row.id)), ...dbOrders]
  }, [demoOrders, dbOrders])

  const filtered = filter === 'all' ? orders : orders.filter((order) => order.status === filter)
  const highlight = params.get('highlight')
  const reorderCounts = useMemo(() => reorderCountsByOrderId(orders), [orders])

  const counts = useMemo(
    () =>
      Object.fromEntries(filters.map(({ id }) => [id, id === 'all' ? orders.length : orders.filter((o) => o.status === id).length])),
    [orders],
  )

  async function changeStatus(id: string, status: OrderStatus) {
    if (isDemoFarmOrderId(id)) {
      setDemoOrders(updateDemoFarmOrderStatus(farm.id, id, status))
      return
    }
    const { error } = await supabase.from('orders').update({ status }).eq('id', id)
    if (!error) {
      setDbOrders((prev) => prev.map((order) => (order.id === id ? { ...order, status } : order)))
    }
  }

  return (
    <>
      <Header
        title="주문 관리"
        subtitle={`총 ${orders.length}건`}
        rightElement={
          <>
            <FarmOrderPageLink slug={farm.slug} />
            <NotificationBell farmPath={`${basePath}/orders`} />
          </>
        }
      />
      <div className="px-4 py-4 md:px-6 max-w-5xl mx-auto space-y-4">
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => navigate(`${basePath}/orders/new`)}>
            <Plus className="h-4 w-4" />
            직접 추가하기
          </Button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {filters.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === id ? 'bg-primary text-white' : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {label}
              <span className="ml-1 text-xs opacity-70">({counts[id] ?? 0})</span>
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <p className="text-center text-muted py-8">해당 상태의 주문이 없습니다</p>
          ) : (
            filtered.map((order) => (
              <div key={order.id} className={highlight === order.id ? 'rounded-2xl ring-2 ring-primary' : ''}>
                <OrderItem
                  order={toOrderListModel(order, { reorderCount: reorderCounts.get(order.id) })}
                  extra={
                    <>
                      {order.status === 'pending_deposit' && (
                        <DepositConfirmExtra
                          orderId={order.id}
                          depositCode={order.deposit_code}
                          onConfirmed={() => {
                            if (isDemoFarmOrderId(order.id)) {
                              setDemoOrders(updateDemoFarmOrderStatus(farm.id, order.id, 'paid'))
                              return
                            }
                            setDbOrders((prev) =>
                              prev.map((row) => (row.id === order.id ? { ...row, status: 'paid' } : row)),
                            )
                          }}
                        />
                      )}
                      <div className="mt-3">
                        <select
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
                          value={order.status}
                          onChange={(e) => void changeStatus(order.id, e.target.value as OrderStatus)}
                        >
                          {farmUpdatableStatuses.map((status) => (
                            <option key={status} value={status}>
                              {statusLabels[status]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  }
                />
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
