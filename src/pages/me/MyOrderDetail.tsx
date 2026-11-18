import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Header } from '../../components/layout/Header'
import { SiteFooter } from '../../components/layout/SiteFooter'
import { DepositGuide } from '../../components/shared/DepositGuide'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { PageSpinner } from '../../components/ui/Feedback'
import { formatPrice, fullAddress } from '../../lib/format'
import { statusLabels } from '../../lib/orderStatus'
import { supabase } from '../../lib/supabase'
import type { Farm, Order, OrderItem } from '../../types/models'

type OrderDetail = Order & { order_items: OrderItem[]; farms: Farm | null }

export function MyOrderDetail() {
  const { orderId = '' } = useParams()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('orders')
      .select('*, order_items(*), farms(*)')
      .eq('id', orderId)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as (Order & { order_items: OrderItem[]; farms: Farm | Farm[] | null }) | null
        if (row) {
          setOrder({
            ...row,
            farms: Array.isArray(row.farms) ? row.farms[0] ?? null : row.farms,
          })
        }
        setLoading(false)
      })
  }, [orderId])

  if (loading) return <PageSpinner />
  if (!order) {
    return <div className="min-h-dvh flex items-center justify-center text-muted">주문을 찾을 수 없습니다</div>
  }

  const farm = order.farms

  return (
    <div className="bg-surface">
      <div className="flex min-h-dvh flex-col pb-10">
        <Header title="주문 상세" subtitle={order.order_no} showBack backTo="/me/orders" />
        <div className="flex-1 px-4 py-4 max-w-lg mx-auto w-full space-y-4">
          <Card className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{farm?.name ?? '농가'}</h3>
              <Badge>{statusLabels[order.status]}</Badge>
            </div>
            {order.order_items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span>
                  {item.product_name} {item.unit} ×{item.quantity}
                </span>
                <span>{formatPrice(item.line_amount)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold pt-2 border-t border-gray-100">
              <span>합계</span>
              <span className="text-primary">{formatPrice(order.total_amount)}</span>
            </div>
          </Card>

          {order.status === 'pending_deposit' && (
            <DepositGuide
              bankName={farm?.bank_name ?? ''}
              accountNumber={farm?.account_number ?? ''}
              accountHolder={farm?.account_holder ?? ''}
              amount={order.deposit_due_amount}
            />
          )}

          <Card>
            <h3 className="font-semibold mb-2">받는 분</h3>
            <p className="text-sm">
              {order.recipient_name} · {order.recipient_phone}
            </p>
            <p className="mt-1 text-sm text-muted">
              {fullAddress(order.address, order.address_detail, order.zonecode)}
            </p>
            {order.request_memo && <p className="mt-2 text-sm">요청사항: {order.request_memo}</p>}
          </Card>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
