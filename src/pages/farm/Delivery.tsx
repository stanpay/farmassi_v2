import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { History, PenLine } from 'lucide-react'
import { Header } from '../../components/layout/Header'
import { KpostParcelExport } from '../../components/shared/KpostParcelExport'
import { OrderItem } from '../../components/shared/OrderItem'
import { ShippingPausePanel } from '../../components/shared/ShippingPausePanel'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { loadDemoFarmOrders } from '../../lib/demoFarmOrders'
import { isDevAuthBypass } from '../../lib/devAuthBypass'
import { useFarmWorkspace } from '../../lib/farmWorkspace'
import { toOrderListModel, type OrderRow } from '../../lib/orders'
import { supabase } from '../../lib/supabase'
import { pauseCovering, pauseMessage, todayInSeoul, type PauseRange } from '../../lib/deliveryEstimate'

const ORDER_SELECT =
  '*, order_items(*, product:products(parcel_weight_kg, parcel_volume_cm, parcel_content_code, parcel_delivery_type)), farms(name, slug)'

const SHIPMENT_STATUSES = new Set(['paid', 'packing'])

function shipmentDemoOrders(farmId: string) {
  return loadDemoFarmOrders(farmId).filter((row) => SHIPMENT_STATUSES.has(row.status))
}

export function FarmDelivery() {
  const { farm, basePath } = useFarmWorkspace()
  const [dbOrders, setDbOrders] = useState<OrderRow[]>([])
  const [demoOrders, setDemoOrders] = useState<OrderRow[]>(() => shipmentDemoOrders(farm.id))
  const [pauses, setPauses] = useState<PauseRange[]>([])
  /**
   * 손님이 출고일을 뒤로 미룬 주문은 그날이 될 때까지 섞이면 안 된다.
   * 기본은 '전체' — 지금 접수할 것만 보인다.
   */
  const [tab, setTab] = useState<'now' | 'later'>('now')

  async function loadOrders() {
    setDemoOrders(shipmentDemoOrders(farm.id))
    // 백엔드 꺼진 로컬 bypass 에서는 API 호출하지 않는다(녹화용 연결 실패 토스트 방지)
    if (isDevAuthBypass()) {
      setDbOrders([])
      return
    }
    const { data } = await supabase
      .from('orders')
      .select(ORDER_SELECT)
      .eq('farm_id', farm.id)
      .in('status', ['paid', 'packing'])
      .order('created_at', { ascending: false })
    setDbOrders((data as OrderRow[]) ?? [])
  }

  useEffect(() => {
    void (async () => {
      if (isDevAuthBypass()) {
        setPauses([])
        return
      }
      const { data } = await supabase
        .from('shipping_pauses').select('start_date, end_date, reason')
        .eq('farm_id', farm.id)
        .gte('end_date', todayInSeoul())
      setPauses((data as PauseRange[]) ?? [])
    })()
  }, [farm.id])

  useEffect(() => {
    void loadOrders()
  }, [farm.id])

  const orders = useMemo(() => {
    const dbIds = new Set(dbOrders.map((row) => row.id))
    return [...demoOrders.filter((row) => !dbIds.has(row.id)), ...dbOrders]
  }, [demoOrders, dbOrders])

  const today = todayInSeoul()
  const [nowOrders, laterOrders] = useMemo(() => {
    const now: OrderRow[] = []
    const later: OrderRow[] = []
    for (const order of orders) {
      const ship = order.requested_ship_date
      // 고른 출고일이 아직 오지 않았으면 대기로 뺀다. 고르지 않았으면 지금 것이다.
      if (ship && ship > today) later.push(order)
      else now.push(order)
    }
    return [now, later]
  }, [orders, today])

  const visible = tab === 'now' ? nowOrders : laterOrders
  const pausedReason = (() => {
    // 정지 기간에는 송장을 만들지 않는다. 송장 자동화가 없으므로
    // 엑셀만 안 뽑으면 그 기간 출고가 멈춘다.
    const hit = pauseCovering(pauses, todayInSeoul())
    return hit ? `${pauseMessage(hit)} · 송장을 만들지 않습니다` : null
  })()

  return (
    <>
      <Header
        title="송장"
        subtitle="우체국 창구소포 엑셀"
        rightElement={
          <div className="flex items-center gap-1.5">
            <Link to="/admin/shipping-manual">
              <Button size="sm" variant="outline">
                <PenLine className="h-4 w-4" />
                직접작성
              </Button>
            </Link>
            <Link to={`${basePath}/delivery/history`}>
              <Button size="sm" variant="outline">
                <History className="h-4 w-4" />
                배송이력 관리
              </Button>
            </Link>
          </div>
        }
      />
      <div className="px-4 py-4 md:px-6 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          {([
            ['now', '전체', nowOrders.length],
            ['later', '송장 접수 대기', laterOrders.length],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                tab === id
                  ? 'bg-primary text-white'
                  : 'border border-gray-200 bg-white text-muted hover:bg-gray-50'
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
        {tab === 'later' && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            손님이 출고일을 뒤로 미뤄 둔 주문입니다. 그날이 되면 &apos;전체&apos; 로 넘어옵니다.
          </p>
        )}
        <ShippingPausePanel farmName={farm.name} farms={[{ id: farm.id, name: farm.name }]} />
        <div className="space-y-3">
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">{farm.name}</h3>
              <p className="text-sm text-muted">출고 대기 {visible.length}건</p>
            </div>
            <KpostParcelExport
              orders={visible}
              farmName={farm.name}
              onUpdated={() => void loadOrders()}
              pausedReason={pausedReason}
            />
          </Card>
          {visible.map((order) => (
            <OrderItem key={order.id} order={toOrderListModel(order)} />
          ))}
        </div>
        {orders.length === 0 && <p className="text-center text-muted py-8">출고 대기 주문이 없습니다</p>}
      </div>
    </>
  )
}
