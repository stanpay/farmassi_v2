import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Header } from '../../components/layout/Header'
import { SiteFooter } from '../../components/layout/SiteFooter'
import { OrderItem } from '../../components/shared/OrderItem'
import { PageSpinner } from '../../components/ui/Feedback'
import { Button } from '../../components/ui/Button'
import { useAuth } from '../../lib/auth'
import { toOrderListModel, type OrderRow } from '../../lib/orders'
import { supabase } from '../../lib/supabase'

export function MyOrders() {
  const { user, signOut } = useAuth()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('orders')
      .select('*, order_items(*), farms(name, slug)')
      .eq('customer_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setOrders((data as OrderRow[]) ?? [])
        setLoading(false)
      })
  }, [user])

  return (
    <div className="bg-surface">
      <div className="flex min-h-dvh flex-col pb-10">
        <Header
          title="내 주문"
          showBack
          backTo="/"
          rightElement={
            <button type="button" className="text-sm text-muted" onClick={() => void signOut()}>
              로그아웃
            </button>
          }
        />
        <div className="flex-1 px-4 py-4 max-w-lg mx-auto w-full space-y-3">
          {loading ? (
            <PageSpinner />
          ) : orders.length === 0 ? (
            <p className="text-center text-muted py-10">주문 내역이 없습니다</p>
          ) : (
            orders.map((order) => (
              <Link key={order.id} to={`/me/orders/${order.id}`} className="block">
                <OrderItem order={toOrderListModel(order)} />
              </Link>
            ))
          )}
          <Link to="/">
            <Button fullWidth variant="outline">
              농가 찾아 주문하기
            </Button>
          </Link>
        </div>
      </div>
      <SiteFooter />
    </div>
  )
}
