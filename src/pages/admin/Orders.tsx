import { useEffect, useMemo, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { Header } from '../../components/layout/Header'
import { FarmFilterChips } from '../../components/shared/FarmFilterChips'
import { OrderItem } from '../../components/shared/OrderItem'
import { OrderStatusFilterChips, type StatusFilterId } from '../../components/shared/OrderStatusFilterChips'
import { adminNavItems } from '../../config/adminNav'
import { statusLabels } from '../../lib/orderStatus'
import { farmsFromOrders, groupOrdersByFarm, toOrderListModel, type OrderRow } from '../../lib/orders'
import { supabase } from '../../lib/supabase'
import type { OrderStatus } from '../../types/models'

export function AdminOrders() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [farmId, setFarmId] = useState<string | 'all'>('all')
  const [status, setStatus] = useState<StatusFilterId>('all')

  async function load() {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*), shipments(*), farms(name, slug)')
      .order('created_at', { ascending: false })
    setOrders((data as OrderRow[]) ?? [])
  }

  useEffect(() => {
    void load()
  }, [])

  const farms = useMemo(() => farmsFromOrders(orders), [orders])
  const farmFiltered = useMemo(
    () => (farmId === 'all' ? orders : orders.filter((order) => order.farm_id === farmId)),
    [farmId, orders],
  )
  const visible = useMemo(
    () => (status === 'all' ? farmFiltered : farmFiltered.filter((order) => order.status === status)),
    [farmFiltered, status],
  )
  const groups = useMemo(() => groupOrdersByFarm(visible), [visible])
  const showGroupHeaders = farmId === 'all' && groups.length > 1

  useEffect(() => {
    if (farmId !== 'all' && !farms.some((farm) => farm.id === farmId)) {
      setFarmId('all')
    }
  }, [farmId, farms])

  return (
    <AppShell navItems={adminNavItems} roleLabel="관리자" settingsPath="/admin/none">
      <Header title="주문" subtitle={`${visible.length}건`} />
      <div className="px-4 py-4 md:px-6 max-w-5xl mx-auto space-y-4">
        <div className="space-y-2">
          <FarmFilterChips farms={farms} selectedId={farmId} onSelect={setFarmId} allCount={orders.length} />
          <OrderStatusFilterChips orders={farmFiltered} selectedId={status} onSelect={setStatus} />
        </div>
        {groups.map((group) => (
          <section key={group.farmId} className="space-y-3">
            {showGroupHeaders && (
              <h3 className="font-semibold text-gray-900">
                {group.name}
                <span className="ml-2 text-sm font-normal text-muted">{group.orders.length}건</span>
              </h3>
            )}
            {group.orders.map((order) => (
              <OrderItem
                key={order.id}
                order={toOrderListModel(order)}
                extra={
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/*
                      출고일을 관리자가 고칠 수 있어야 한다. 손님이 미뤄 둔
                      날짜를 앞당기거나, 농가 사정으로 미루는 일이 생긴다.
                      비우면 가장 이른 출고일로 되돌아간다.
                    */}
                    <label className="flex items-center gap-1.5 text-xs text-muted">
                      출고일
                      <input
                        type="date"
                        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                        value={order.requested_ship_date ?? ''}
                        onChange={async (e) => {
                          const next = e.target.value || null
                          await supabase.from('orders').update({ requested_ship_date: next }).eq('id', order.id)
                          await load()
                        }}
                      />
                    </label>
                    <select
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
                      value={order.status}
                      onChange={async (e) => {
                        await supabase.from('orders').update({ status: e.target.value as OrderStatus }).eq('id', order.id)
                        await load()
                      }}
                    >
                      {(Object.keys(statusLabels) as OrderStatus[]).map((status) => (
                        <option key={status} value={status}>
                          {statusLabels[status]}
                        </option>
                      ))}
                    </select>
                  </div>
                }
              />
            ))}
          </section>
        ))}
        {visible.length === 0 && (
          <p className="text-center text-muted py-8">
            {status === 'all' ? '주문이 없습니다' : '해당 상태의 주문이 없습니다'}
          </p>
        )}
      </div>
    </AppShell>
  )
}
