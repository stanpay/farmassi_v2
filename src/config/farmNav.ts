import { Boxes, CreditCard, LayoutDashboard, Package, Settings, Truck, Users } from 'lucide-react'
import type { NavItem } from '../components/layout/BottomNav'

export function farmNavItems(basePath: string): NavItem[] {
  return [
    { to: basePath, label: '대시보드', icon: LayoutDashboard, end: true },
    { to: `${basePath}/products`, label: '상품', icon: Boxes },
    { to: `${basePath}/orders`, label: '주문', icon: Package },
    { to: `${basePath}/customers`, label: '고객', icon: Users },
    { to: `${basePath}/deposits`, label: '입금', icon: CreditCard },
    { to: `${basePath}/delivery`, label: '송장', icon: Truck },
    { to: `${basePath}/settings`, label: '설정', icon: Settings },
  ]
}
