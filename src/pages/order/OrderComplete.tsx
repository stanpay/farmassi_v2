import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { Header } from '../../components/layout/Header'
import { SiteFooter } from '../../components/layout/SiteFooter'
import { DepositGuide } from '../../components/shared/DepositGuide'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PageSpinner } from '../../components/ui/Feedback'
import { formatPrice } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { Farm, Order, OrderItem } from '../../types/models'

type OrderDetail = Order & { order_items: OrderItem[]; farms: Farm | null }

export function OrderComplete() {
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

  if (loading) return <PageSpinner label="주문 내역을 불러오는 중..." />
  if (!order) {
    return <div className="min-h-dvh flex items-center justify-center text-muted">주문을 찾을 수 없습니다</div>
  }

  const farm = order.farms

  return (
    <div className="bg-surface">
      <div className="flex min-h-dvh flex-col pb-10">
        <Header title="주문 완료" subtitle={order.order_no} showBack backTo="/me/orders" />
        <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
          <div className="flex flex-col items-center text-center py-2">
            <CheckCircle2 className="h-14 w-14 text-primary" />
            <p className="mt-3 text-xl font-bold text-gray-900">주문이 완료되었습니다</p>
            <p className="mt-1 text-sm text-muted">{farm?.name ?? '농가'} · {order.order_no}</p>
          </div>

          <DepositGuide
            bankName={farm?.bank_name ?? ''}
            accountNumber={farm?.account_number ?? ''}
            accountHolder={farm?.account_holder ?? ''}
            amount={order.deposit_due_amount}
          />

          <Card>
            <h3 className="font-semibold mb-3">주문 상품</h3>
            <div className="space-y-2">
              {order.order_items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span>
                    {item.product_name} {item.unit} ×{item.quantity}
                  </span>
                  <span>{formatPrice(item.line_amount)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between font-bold pt-2 border-t border-gray-100">
              <span>합계</span>
              <span className="text-primary">{formatPrice(order.total_amount)}</span>
            </div>
          </Card>

          <Link to={`/me/orders/${order.id}`} className="block">
            <Button fullWidth variant="outline">
              주문 상세 보기
            </Button>
          </Link>
          <Link to="/me/orders" className="block">
            <Button fullWidth>
              내 주문 목록
            </Button>
          </Link>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
