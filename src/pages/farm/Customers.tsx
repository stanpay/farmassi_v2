import { useCallback, useEffect, useMemo, useState } from 'react'
import { CustomersPanel } from '../../components/shared/CustomersPanel'
import { loadDemoFarmOrders } from '../../lib/demoFarmOrders'
import { useFarmWorkspace } from '../../lib/farmWorkspace'
import type { OrderRow } from '../../lib/orders'
import { supabase } from '../../lib/supabase'

export function FarmCustomers() {
  const { farm } = useFarmWorkspace()
  const [dbOrders, setDbOrders] = useState<OrderRow[]>([])
  const [demoOrders, setDemoOrders] = useState<OrderRow[]>(() => loadDemoFarmOrders(farm.id))
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setDemoOrders(loadDemoFarmOrders(farm.id))
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*), shipments(*), farms(name, slug)')
      .eq('farm_id', farm.id)
      .order('created_at', { ascending: false })
    setDbOrders((data as OrderRow[]) ?? [])
    setLoading(false)
  }, [farm.id])

  useEffect(() => {
    void load()
  }, [load])

  const orders = useMemo(() => {
    const dbIds = new Set(dbOrders.map((row) => row.id))
    return [...demoOrders.filter((row) => !dbIds.has(row.id)), ...dbOrders]
  }, [demoOrders, dbOrders])

  return (
    <CustomersPanel
      orders={orders}
      loading={loading}
      onRefresh={() => void load()}
    />
  )
}
