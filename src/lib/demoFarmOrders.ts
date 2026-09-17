import type { OrderRow } from './orders'
import type { OrderStatus } from '../types/models'
import { digitsOnly } from './phone'

const STORAGE_PREFIX = 'farmassi:demo-farm-orders:'
/** 올리면 기존 데모 주문을 한 번 비운다(영상용 초기화). */
const DEMO_ORDERS_EPOCH = '2026-08-reset'

/** 데모 주문 시각 — 영상 녹화용으로 8월로 고정. */
const DEMO_BASE_TIME = Date.parse('2026-08-15T10:00:00+09:00')

/** 이미 저장된 데모 주문에 우편번호가 비어 있으면 주소로 채운다. */
const DEMO_ZONE_BY_ADDRESS: [RegExp, string][] = [
  [/마포구|성미산|성마산/, '03978'],
  [/분당|판교/, '13494'],
  [/해운대|센텀/, '48058'],
]

/** 상세가 기본주소에 붙어 저장된 데모 건을 다시 나눈다. 성마산로 오타는 교정하지 않는다. */
const DEMO_ADDRESS_SPLIT: [RegExp, string, string][] = [
  [/성마산로11길\s*32-7/, '서울 마포구 성마산로11길 32-7', '예림 아너스아파트 701호'],
  [/성미산로11길\s*32-7/, '서울 마포구 성미산로11길 32-7', '예림 아너스아파트 701호'],
  [/서판교로\s*165|판교로\s*245|별빛마을/, '경기도 성남시 분당구 서판교로 165', '1202동 103호'],
  [/센텀중앙로\s*97/, '부산 해운대구 센텀중앙로 97', '바다뷰APT 1502동 804호'],
]

function withDemoZonecode(row: OrderRow): OrderRow {
  if (row.zonecode && /^\d{5}$/.test(String(row.zonecode))) return row
  const address = row.address ?? ''
  for (const [re, zip] of DEMO_ZONE_BY_ADDRESS) {
    if (re.test(address)) return { ...row, zonecode: zip }
  }
  return row
}

function withDemoAddressParts(row: OrderRow): OrderRow {
  let next = withDemoZonecode(row)
  // 데모 판교 건은 이서준과 같은 연락처로 묶어 재구매 고객 1명만 만든다.
  if (/판교/.test(next.address ?? '') || next.recipient_name === '최유진') {
    next = {
      ...next,
      recipient_name: '이서준',
      recipient_phone: '010-1111-2222',
    }
  }
  // 이미 저장된 옛 판교 주소도 서판교로로 교체
  const joined = `${next.address ?? ''} ${next.address_detail ?? ''}`
  if (/판교로\s*245|별빛마을/.test(joined)) {
    next = {
      ...next,
      address: '경기도 성남시 분당구 서판교로 165',
      address_detail: '1202동 103호',
    }
  }
  if (next.address_detail?.trim()) return next

  for (const [re, base, detail] of DEMO_ADDRESS_SPLIT) {
    if (re.test(next.address ?? '')) {
      return { ...next, address: base, address_detail: detail }
    }
  }

  // 도로 번지 뒤 동·호 / N호 를 상세로 분리
  const match = (next.address ?? '').match(
    /^(.*?\d(?:-\d+)?)\s+((?:[가-힣A-Za-z0-9]+\s*)*(?:아파트|APT|Apt|빌라)?\s*\d+\s*동\s*\d+\s*호|.+\s*\d+\s*호)$/i,
  )
  if (match) {
    return { ...next, address: match[1].trim(), address_detail: match[2].trim() }
  }
  return next
}

/**
 * 데모: 이서준 마포 건이 재주문으로 보이도록 판교 건을 하루 전으로 둔다.
 */
function ensureDemoReorderHistory(orders: OrderRow[]): OrderRow[] {
  const phone = '01011112222'
  const group = orders.filter((row) => digitsOnly(row.recipient_phone ?? '') === phone)
  if (group.length < 2) return orders

  const pangyo = group.find((row) => /판교/.test(row.address ?? ''))
  const mapo = group.find((row) => /마포|성미산|성마산/.test(row.address ?? ''))
  if (!pangyo || !mapo) return orders
  if (pangyo.created_at < mapo.created_at) return orders

  const earlier = new Date(new Date(mapo.created_at).getTime() - 24 * 60 * 60 * 1000).toISOString()
  return orders.map((row) => (row.id === pangyo.id ? { ...row, created_at: earlier } : row))
}

function demoCreatedAt(index: number): string {
  // 같은 배치 안에서는 index 가 클수록 조금 더 나중(분 단위)
  return new Date(DEMO_BASE_TIME + index * 60_000).toISOString()
}

export type DemoDraftInput = {
  id: string
  recipientName: string
  phone: string
  address: string
  addressDetail?: string
  zonecode: string
  product: string
  quantity: number
  depositorName: string
  memo: string
  unitPrice: number
}

function storageKey(farmId: string) {
  return `${STORAGE_PREFIX}${farmId}`
}

function epochKey(farmId: string) {
  return `${STORAGE_PREFIX}epoch:${farmId}`
}

/** 에폭이 바뀌면 해당 농가 데모 주문을 비운다. */
function wipeIfEpochChanged(farmId: string) {
  const key = epochKey(farmId)
  if (sessionStorage.getItem(key) === DEMO_ORDERS_EPOCH) return
  sessionStorage.removeItem(storageKey(farmId))
  sessionStorage.setItem(key, DEMO_ORDERS_EPOCH)
}

export function clearDemoFarmOrders(farmId?: string) {
  if (farmId) {
    sessionStorage.removeItem(storageKey(farmId))
    return
  }
  for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
    const key = sessionStorage.key(i)
    if (key?.startsWith(STORAGE_PREFIX) && !key.includes(':epoch:')) {
      sessionStorage.removeItem(key)
    }
  }
}

export function loadDemoFarmOrders(farmId: string): OrderRow[] {
  try {
    wipeIfEpochChanged(farmId)
    const raw = sessionStorage.getItem(storageKey(farmId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as OrderRow[]
    if (!Array.isArray(parsed)) return []
    return ensureDemoReorderHistory(parsed.map(withDemoAddressParts))
  } catch {
    return []
  }
}

export function saveDemoFarmOrders(farmId: string, orders: OrderRow[]) {
  sessionStorage.setItem(storageKey(farmId), JSON.stringify(orders))
}

export function appendDemoFarmOrders(farmId: string, drafts: DemoDraftInput[]): OrderRow[] {
  const stamp = '26081510'
  const created = drafts.map((draft, index) => {
    const amount = draft.unitPrice * draft.quantity
    const orderId = `demo-${draft.id}`
    const at = demoCreatedAt(index)
    const row: OrderRow = {
      id: orderId,
      order_no: `DEMO-${stamp}-${String(index + 1).padStart(2, '0')}`,
      farm_id: farmId,
      customer_id: 'demo-customer',
      status: 'pending_deposit',
      recipient_name: draft.recipientName,
      recipient_phone: draft.phone,
      zonecode: draft.zonecode || null,
      address: draft.address,
      address_detail: draft.addressDetail?.trim() || null,
      request_memo: draft.memo || null,
      total_amount: amount,
      deposit_due_amount: amount,
      deposit_code: `D${String(100000 + index)}`.slice(0, 6),
      deposit_confirmed_at: null,
      deposit_confirmed_by: null,
      deposit_provider: null,
      depositor_name: draft.depositorName || draft.recipientName,
      sender_name: draft.depositorName || null,
      sender_phone: null,
      sender_address: null,
      sender_zonecode: null,
      sender_address_detail: null,
      shipping_fee: 0,
      requested_ship_date: null,
      created_at: at,
      updated_at: at,
      order_items: [
        {
          id: `${orderId}-item`,
          order_id: orderId,
          product_id: null,
          product_name: draft.product,
          unit: null,
          unit_price: draft.unitPrice,
          quantity: draft.quantity,
          line_amount: amount,
        },
      ],
      shipments: [],
    }
    return row
  })

  const next = [...created, ...loadDemoFarmOrders(farmId)]
  saveDemoFarmOrders(farmId, next)
  return next
}

export function updateDemoFarmOrderStatus(farmId: string, orderId: string, status: OrderStatus) {
  if (!orderId.startsWith('demo-')) return loadDemoFarmOrders(farmId)
  const next = loadDemoFarmOrders(farmId).map((row) =>
    row.id === orderId ? { ...row, status, updated_at: new Date().toISOString() } : row,
  )
  saveDemoFarmOrders(farmId, next)
  return next
}

export function isDemoFarmOrderId(orderId: string) {
  return orderId.startsWith('demo-')
}
