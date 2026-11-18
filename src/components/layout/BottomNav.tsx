import type { LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

interface BottomNavProps {
  items: NavItem[]
}

export function BottomNav({ items }: BottomNavProps) {
  const itemPadding = items.length > 6 ? 'px-1.5' : 'px-3'
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-100 bg-white md:hidden">
      <div className="flex items-center justify-around px-2 py-2 safe-area-bottom">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 ${itemPadding} py-1.5 rounded-xl transition-colors ${
                isActive ? 'text-primary' : 'text-gray-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                <span className="text-[10px] font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
