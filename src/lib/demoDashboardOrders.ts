import type { OrderRow } from './orders'
import type { OrderStatus } from '../types/models'

type DemoSeed = {
  month: number // 1-12
  day: number
  name: string
  phone: string
  product: string
  qty: number
  price: number
  status: OrderStatus
}

/**
 * 대시보드 차트·카드용 더미 주문.
 * 주문/입금 목록(sessionStorage)과는 별개라 영상용 직접추가 흐름을 건드리지 않는다.
 */
const SEEDS: DemoSeed[] = [
  // 4월
  { month: 4, day: 3, name: '김민수', phone: '010-2000-1001', product: '포도즙', qty: 2, price: 25000, status: 'completed' },
  { month: 4, day: 12, name: '이서연', phone: '010-2000-1002', product: '씨없는포도 3kg', qty: 1, price: 28000, status: 'completed' },
  { month: 4, day: 22, name: '박준호', phone: '010-2000-1003', product: '포도즙', qty: 1, price: 25000, status: 'completed' },
  // 5월
  { month: 5, day: 5, name: '최유진', phone: '010-2000-1004', product: '샤인머스켓 2kg', qty: 2, price: 32000, status: 'completed' },
  { month: 5, day: 9, name: '김민수', phone: '010-2000-1001', product: '포도즙', qty: 3, price: 25000, status: 'completed' },
  { month: 5, day: 18, name: '한도윤', phone: '010-2000-1005', product: '못난이포도 5kg', qty: 1, price: 22000, status: 'completed' },
  { month: 5, day: 27, name: '정서아', phone: '010-2000-1006', product: '씨없는포도 3kg', qty: 2, price: 28000, status: 'completed' },
  // 6월
  { month: 6, day: 2, name: '오세진', phone: '010-2000-1007', product: '포도즙', qty: 4, price: 25000, status: 'completed' },
  { month: 6, day: 8, name: '이서연', phone: '010-2000-1002', product: '샤인머스켓 2kg', qty: 1, price: 32000, status: 'completed' },
  { month: 6, day: 15, name: '강하늘', phone: '010-2000-1008', product: '포도즙', qty: 2, price: 25000, status: 'completed' },
  { month: 6, day: 21, name: '윤채원', phone: '010-2000-1009', product: '씨없는포도 3kg', qty: 1, price: 28000, status: 'completed' },
  { month: 6, day: 28, name: '김민수', phone: '010-2000-1001', product: '못난이포도 5kg', qty: 2, price: 22000, status: 'completed' },
  // 7월
  { month: 7, day: 4, name: '배수아', phone: '010-2000-1010', product: '샤인머스켓 2kg', qty: 3, price: 32000, status: 'completed' },
  { month: 7, day: 11, name: '한도윤', phone: '010-2000-1005', product: '포도즙', qty: 2, price: 25000, status: 'completed' },
  { month: 7, day: 16, name: '조은별', phone: '010-2000-1011', product: '씨없는포도 3kg', qty: 2, price: 28000, status: 'completed' },
  { month: 7, day: 23, name: '신우진', phone: '010-2000-1012', product: '포도즙', qty: 1, price: 25000, status: 'completed' },
  { month: 7, day: 29, name: '최유진', phone: '010-2000-1004', product: '샤인머스켓 2kg', qty: 2, price: 32000, status: 'completed' },
  // 8월 (피크)
  { month: 8, day: 3, name: '이서준', phone: '010-1111-2222', product: '포도즙', qty: 1, price: 25000, status: 'completed' },
  { month: 8, day: 5, name: '박하은', phone: '010-2000-1013', product: '씨없는포도 3kg', qty: 3, price: 28000, status: 'completed' },
  { month: 8, day: 8, name: '김민수', phone: '010-2000-1001', product: '포도즙', qty: 5, price: 25000, status: 'completed' },
  { month: 8, day: 12, name: '이서준', phone: '010-1111-2222', product: '샤인머스켓 2kg', qty: 2, price: 32000, status: 'completed' },
  { month: 8, day: 14, name: '한도윤', phone: '010-7777-8888', product: '씨없는포도 3kg', qty: 1, price: 28000, status: 'completed' },
  { month: 8, day: 18, name: '강하늘', phone: '010-2000-1008', product: '못난이포도 5kg', qty: 2, price: 22000, status: 'completed' },
  { month: 8, day: 22, name: '윤채원', phone: '010-2000-1009', product: '포도즙', qty: 3, price: 25000, status: 'completed' },
  { month: 8, day: 26, name: '배수아', phone: '010-2000-1010', product: '샤인머스켓 2kg', qty: 1, price: 32000, status: 'completed' },
  { month: 8, day: 29, name: '오세진', phone: '010-2000-1007', product: '포도즙', qty: 2, price: 25000, status: 'completed' },
  // 9월
  { month: 9, day: 2, name: '정서아', phone: '010-2000-1006', product: '씨없는포도 3kg', qty: 2, price: 28000, status: 'completed' },
  { month: 9, day: 6, name: '신우진', phone: '010-2000-1012', product: '포도즙', qty: 1, price: 25000, status: 'completed' },
  { month: 9, day: 10, name: '조은별', phone: '010-2000-1011', product: '샤인머스켓 2kg', qty: 2, price: 32000, status: 'packing' },
  { month: 9, day: 14, name: '이서연', phone: '010-2000-1002', product: '못난이포도 5kg', qty: 1, price: 22000, status: 'paid' },
  { month: 9, day: 16, name: '박준호', phone: '010-2000-1003', product: '포도즙', qty: 2, price: 25000, status: 'paid' },
  { month: 9, day: 17, name: '김도현', phone: '010-2000-1014', product: '씨없는포도 3kg', qty: 1, price: 28000, status: 'pending_deposit' },
  { month: 9, day: 17, name: '송지아', phone: '010-2000-1015', product: '포도즙', qty: 3, price: 25000, status: 'pending_deposit' },
  { month: 9, day: 17, name: '유나경', phone: '010-2000-1016', product: '샤인머스켓 2kg', qty: 1, price: 32000, status: 'paid' },
]

function atSeoul(year: number, month: number, day: number, hour = 11, minute = 0): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  // +09:00 고정 → Date 파싱 시 월별 집계가 어긋나지 않게
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+09:00`
}

export function demoDashboardOrders(farmId: string, year = 2026): OrderRow[] {
  return SEEDS.map((seed, index) => {
    const amount = seed.price * seed.qty
    const created = atSeoul(year, seed.month, seed.day, 10 + (index % 8), (index * 7) % 60)
    const id = `dash-demo-${farmId.slice(0, 8)}-${index}`
    return {
      id,
      order_no: `DEMO-D${String(1000 + index)}`,
      farm_id: farmId,
      customer_id: 'demo-dashboard',
      status: seed.status,
      recipient_name: seed.name,
      recipient_phone: seed.phone,
      zonecode: '03978',
      address: '서울 마포구 성미산로11길 32-7',
      address_detail: '701호',
      request_memo: null,
      total_amount: amount,
      deposit_due_amount: amount,
      deposit_code: `D${String(200000 + index)}`.slice(0, 6),
      deposit_confirmed_at: seed.status === 'pending_deposit' ? null : created,
      deposit_confirmed_by: null,
      deposit_provider: seed.status === 'pending_deposit' ? null : 'manual',
      depositor_name: seed.name,
      sender_name: seed.name,
      sender_phone: null,
      sender_address: null,
      sender_zonecode: null,
      sender_address_detail: null,
      shipping_fee: 0,
      requested_ship_date: null,
      created_at: created,
      updated_at: created,
      order_items: [
        {
          id: `${id}-item`,
          order_id: id,
          product_id: null,
          product_name: seed.product,
          unit: null,
          unit_price: seed.price,
          quantity: seed.qty,
          line_amount: amount,
        },
      ],
      shipments: [],
      farms: { name: '초록빛 농장', slug: 'demo' },
    } satisfies OrderRow
  })
}
