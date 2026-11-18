import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Header } from '../../components/layout/Header'
import { DepositConfirmExtra } from '../../components/shared/DepositConfirmExtra'
import { OrderItem } from '../../components/shared/OrderItem'
import { useFarmWorkspace } from '../../lib/farmWorkspace'
import {
  isDemoFarmOrderId,
  loadDemoFarmOrders,
  updateDemoFarmOrderStatus,
} from '../../lib/demoFarmOrders'
import { toOrderListModel, type OrderRow } from '../../lib/orders'
import { supabase } from '../../lib/supabase'

function pendingDemoOrders(farmId: string) {
  return loadDemoFarmOrders(farmId).filter((row) => row.status === 'pending_deposit')
}

export function FarmDeposits() {
  const { farm, basePath } = useFarmWorkspace()
  const [dbOrders, setDbOrders] = useState<OrderRow[]>([])
  const [demoOrders, setDemoOrders] = useState<OrderRow[]>(() => pendingDemoOrders(farm.id))

  const load = useCallback(async () => {
    setDemoOrders(pendingDemoOrders(farm.id))
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*), farms(name, slug)')
      .eq('farm_id', farm.id)
      .eq('status', 'pending_deposit')
      .order('created_at', { ascending: false })
    setDbOrders(((data as OrderRow[]) ?? []).filter((row) => row.status === 'pending_deposit'))
  }, [farm.id])

  useEffect(() => {
    void load()
  }, [load])

  const orders = useMemo(() => {
    const pendingDb = dbOrders.filter((row) => row.status === 'pending_deposit')
    const pendingDemo = demoOrders.filter((row) => row.status === 'pending_deposit')
    const dbIds = new Set(pendingDb.map((row) => row.id))
    return [...pendingDemo.filter((row) => !dbIds.has(row.id)), ...pendingDb]
  }, [demoOrders, dbOrders])

  return (
    <>
      <Header title="입금 확인" subtitle={`${orders.length}건 대기`} />
      <div className="px-4 pt-4 md:px-6 max-w-3xl mx-auto">
        <Link
          to={`${basePath}/deposits/ledger`}
          className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3"
        >
          <span className="text-sm text-gray-900">
            입금 내역 원장
            <span className="ml-2 text-xs text-muted">자동으로 붙지 않은 입금 직접 연결</span>
          </span>
          <span className="text-sm font-semibold text-primary">열기</span>
        </Link>
      </div>
      <div className="px-4 py-4 md:px-6 max-w-5xl mx-auto space-y-3">
        {orders.map((order) => (
          <OrderItem
            key={order.id}
            order={toOrderListModel(order)}
            extra={
              <DepositConfirmExtra
                orderId={order.id}
                depositCode={order.deposit_code}
                onConfirmed={() => {
                  if (isDemoFarmOrderId(order.id)) {
                    setDemoOrders(
                      updateDemoFarmOrderStatus(farm.id, order.id, 'paid').filter(
                        (row) => row.status === 'pending_deposit',
                      ),
                    )
                    return
                  }
                  void load()
                }}
              />
            }
          />
        ))}
        {orders.length === 0 && <p className="text-sm text-muted">입금 대기 주문이 없습니다.</p>}
      </div>
    </>
  )
}
