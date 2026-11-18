import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppShell } from '../../components/layout/AppShell'
import { CustomersPanel } from '../../components/shared/CustomersPanel'
import { FarmFilterChips } from '../../components/shared/FarmFilterChips'
import { adminNavItems } from '../../config/adminNav'
import { farmsFromOrders, type OrderRow } from '../../lib/orders'
import { supabase } from '../../lib/supabase'

export function AdminCustomers() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [farmId, setFarmId] = useState<string | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*), shipments(*), farms(name, slug)')
      .order('created_at', { ascending: false })
    setOrders((data as OrderRow[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const farms = useMemo(() => farmsFromOrders(orders), [orders])
  const visible = useMemo(
    () => (farmId === 'all' ? orders : orders.filter((order) => order.farm_id === farmId)),
    [farmId, orders],
  )

  useEffect(() => {
    if (farmId !== 'all' && !farms.some((farm) => farm.id === farmId)) {
      setFarmId('all')
    }
  }, [farmId, farms])

  return (
    <AppShell navItems={adminNavItems} roleLabel="관리자" settingsPath="/admin/none">
      <CustomersPanel
        orders={visible}
        loading={loading}
        onRefresh={() => void load()}
        showFarmColumn={farmId === 'all'}
        toolbar={
          <FarmFilterChips farms={farms} selectedId={farmId} onSelect={setFarmId} allCount={orders.length} />
        }
      />
    </AppShell>
  )
}
