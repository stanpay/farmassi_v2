import { useMemo, useState } from 'react'
import { Input } from '../../components/ui/Field'
import { formatDateTime } from '../../lib/format'
import { statusLabels } from '../../lib/orderStatus'
import type { OrderStatus } from '../../types/models'

export interface RecentOrder {
  id: string
  order_no: string
  status: OrderStatus
  created_at: string
  sender_name: string | null
  recipient_name: string | null
  depositor_name: string | null
  farms: { name: string } | null
}

/** 주문번호 고르기: 최신 주문이 드롭다운으로 뜨고, 직접 입력도 된다. */
export const RECENT_ORDER_LIMIT = 100

/**
 * 주문번호 입력 + 최신 주문 드롭다운.
 * - 칸을 누르면 최신 주문이 최신순으로 뜬다. 입력하면 주문번호·이름·농가로 걸러진다.
 * - 목록에서 고르면 바로 불러온다. 화살표·Enter 로도 고를 수 있다.
 * - 목록에 없는 (오래된) 주문은 번호를 다 입력하고 Enter 나 '불러오기' (정확히 일치하는 번호로 찾음).
 */
export function OrderNoCombobox({
  value,
  onChange,
  orders,
  onPick,
  emptyText,
}: {
  value: string
  onChange: (value: string) => void
  orders: RecentOrder[] | null
  onPick: (order: RecentOrder) => void
  /** 목록에 없을 때 안내 (기본: 최신 N건에 없음) */
  emptyText?: string
}) {
  const [show, setShow] = useState(false)
  const [active, setActive] = useState(-1)
  const q = value.trim().toLowerCase()
  const matches = useMemo(() => {
    const list = orders ?? []
    if (!q) return list
    return list.filter((o) =>
      [o.order_no, o.sender_name, o.recipient_name, o.depositor_name, o.farms?.name]
        .some((text) => (text ?? '').toLowerCase().includes(q)),
    )
  }, [orders, q])

  function pick(order: RecentOrder) {
    setShow(false)
    setActive(-1)
    onPick(order)
  }

  return (
    <div>
      <Input
        label="주문번호"
        value={value}
        placeholder="눌러서 최신 주문 고르기, 또는 번호 입력"
        role="combobox"
        aria-expanded={show}
        aria-controls="alimtalk-order-list"
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onChange={(e) => {
          onChange(e.target.value)
          setShow(true)
          setActive(-1)
        }}
        onKeyDown={(e) => {
          // 목록에서 고르지 않고 Enter: 입력한 번호로 찾는다(폼 제출). 목록은 닫는다.
          if (e.key === 'Enter' && active < 0) {
            setShow(false)
            return
          }
          if (!show || matches.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && active >= 0) {
            // 목록에서 고른 상태면 그 주문. 아니면 폼 제출(정확한 번호로 찾기)로 넘긴다.
            e.preventDefault()
            pick(matches[active])
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setShow(false)
          }
        }}
      />
      {show && (
        <ul
          id="alimtalk-order-list"
          role="listbox"
          aria-label="최신 주문"
          // 창 본문이 스크롤 영역이라 띄우면(absolute) 잘린다. 흐름 안에 두어 창이 늘어나게 한다.
          className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm"
        >
          {orders === null ? (
            <li className="px-3 py-2 text-sm text-muted">불러오는 중...</li>
          ) : matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">
              {emptyText ?? `최신 ${RECENT_ORDER_LIMIT}건에 없습니다. 번호를 다 입력하고 Enter 를 누르면 찾아봅니다.`}
            </li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={i === active}
                // 입력칸 blur 보다 먼저 고르도록 mousedown 에서 처리한다.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(o)
                }}
                className={`cursor-pointer border-b border-gray-50 px-3 py-2 text-sm last:border-0 ${
                  i === active ? 'bg-primary/10' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{o.order_no}</span>
                  <span className="text-xs text-muted">{statusLabels[o.status] ?? o.status}</span>
                </div>
                <div className="text-xs text-muted">
                  {[o.farms?.name, o.sender_name || o.depositor_name || o.recipient_name, formatDateTime(o.created_at)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
