import { supabase } from './supabase'

/**
 * 배송 이력 관리 데이터.
 *
 * 송장을 대신 접수한 건을 농가별·날짜별로 적어 정산한다. 건당 500원.
 * 요청자가 "훼손되면 곤란"하다고 못박은 자료라 지우지 않고 upsert 로 덮는다.
 */
export const FEE_PER_SHIPMENT = 500
export const CHANNELS = ['직접연락', '카톡 비즈니스', '팜어시'] as const
export type Channel = (typeof CHANNELS)[number]
/** 사이트 주문이라 자동 집계된다. 손으로 고칠 때는 경고를 거친다. */
export const AUTO_CHANNEL: Channel = '팜어시'

export interface HistoryFarm {
  id: string
  name: string
  /** 배송 가능 요일 (0=일 … 6=토) */
  deliveryDays: number[]
}

export interface HistoryCell {
  count: number
  receiptText: string
}

export interface HistoryDay {
  date: string
  cells: Record<string, Record<Channel, HistoryCell>>
  productQty: Record<string, Record<string, number>>
}

export const emptyCell = (): HistoryCell => ({ count: 0, receiptText: '' })

export function emptyFarmCells(): Record<Channel, HistoryCell> {
  return { 직접연락: emptyCell(), '카톡 비즈니스': emptyCell(), 팜어시: emptyCell() }
}

/** 정산 대상 농가. 비활성 농가도 지난 이력이 있으므로 전부 가져온다. */
export async function loadFarms(): Promise<HistoryFarm[]> {
  // 비활성 농가는 더 이상 송장을 대행하지 않으므로 이력 화면에서 뺀다.
  const { data } = await supabase
    .from('farms')
    .select('id, name, delivery_days')
    .eq('is_active', true)
    .order('name')
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    deliveryDays: Array.isArray(row.delivery_days) ? row.delivery_days.map(Number) : [],
  }))
}

/**
 * 농원별 판매 품목.
 *
 * 많이 팔린 순으로 보여야 해서 주문 수량을 세어 정렬한다. '기타'는 항상
 * 맨 마지막이라 여기서 붙이지 않고 화면에서 더한다.
 */
export async function loadFarmProducts(): Promise<Record<string, { id: string; name: string }[]>> {
  const { data } = await supabase
    .from('products').select('id, farm_id, name, sort_order').order('sort_order')
  const byFarm: Record<string, { id: string; name: string }[]> = {}
  for (const row of (data ?? []) as any[]) {
    (byFarm[row.farm_id] ??= []).push({ id: row.id, name: row.name })
  }
  return byFarm
}

const monthRange = (year: number, month: number) => {
  const last = new Date(year, month, 0).getDate()
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` }
}

/** 그 달의 저장된 이력을 화면 자료구조로 읽어 온다. */
export async function loadMonth(
  year: number,
  month: number,
  farms: HistoryFarm[],
  /** 저장은 상품 이름으로 한다. 화면 키는 상품 id 라 여기서 되돌린다. */
  farmProducts: Record<string, { id: string; name: string }[]> = {},
): Promise<HistoryDay[]> {
  const { from, to } = monthRange(year, month)
  const [cells, products] = await Promise.all([
    supabase.from('shipping_history').select('entry_date, farm_id, channel, count, receipt_text')
      .gte('entry_date', from).lte('entry_date', to),
    supabase.from('shipping_history_products').select('entry_date, farm_id, product_name, quantity')
      .gte('entry_date', from).lte('entry_date', to),
  ])

  const byDate = new Map<string, HistoryDay>()
  const ensure = (date: string) => {
    let day = byDate.get(date)
    if (!day) {
      day = {
        date,
        cells: Object.fromEntries(farms.map((f) => [f.id, emptyFarmCells()])),
        productQty: Object.fromEntries(farms.map((f) => [f.id, {}])),
      }
      byDate.set(date, day)
    }
    return day
  }

  for (const row of (cells.data ?? []) as any[]) {
    const day = ensure(row.entry_date)
    const farm = (day.cells[row.farm_id] ??= emptyFarmCells())
    farm[row.channel as Channel] = { count: row.count ?? 0, receiptText: row.receipt_text ?? '' }
  }
  // 이름 → id 로 되돌린다. 지워진 상품이면 id 를 못 찾으므로 이름을 그대로 쓴다.
  const idByName = new Map<string, Map<string, string>>()
  for (const [farmId, list] of Object.entries(farmProducts)) {
    idByName.set(farmId, new Map(list.map((p) => [p.name, p.id])))
  }
  for (const row of (products.data ?? []) as any[]) {
    const day = ensure(row.entry_date)
    const key = idByName.get(row.farm_id)?.get(row.product_name) ?? row.product_name
    ;(day.productQty[row.farm_id] ??= {})[key] = row.quantity ?? 0
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
}

/** 한 칸 저장. 0 이어도 지우지 않고 남긴다 — 적었다는 사실이 기록이다. */
export async function saveCell(
  date: string, farmId: string, channel: Channel, cell: HistoryCell,
): Promise<string | null> {
  const { error } = await supabase.from('shipping_history').upsert({
    entry_date: date, farm_id: farmId, channel,
    count: cell.count, receipt_text: cell.receiptText || null,
  }, { onConflict: 'entry_date,farm_id,channel' })
  return error?.message ?? null
}

export async function saveProductQty(
  date: string, farmId: string, productName: string, quantity: number,
): Promise<string | null> {
  const { error } = await supabase.from('shipping_history_products').upsert({
    entry_date: date, farm_id: farmId, product_name: productName, quantity,
  }, { onConflict: 'entry_date,farm_id,product_name' })
  return error?.message ?? null
}

/**
 * 팜어시 채널 자동 집계.
 *
 * 사이트로 들어온 주문을 날짜·농가별로 센다. 사람이 고친 값이 있으면
 * 덮지 않는다 — 수동 수정이 자동 집계보다 우선이다.
 */
export async function autoCountFarmassi(year: number, month: number): Promise<Record<string, Record<string, number>>> {
  const { from, to } = monthRange(year, month)
  const { data } = await supabase.from('orders').select('farm_id, created_at')
    .gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`)
  const byDate: Record<string, Record<string, number>> = {}
  for (const row of (data ?? []) as any[]) {
    // created_at 은 UTC 라 서울 날짜로 바꿔 센다.
    const date = new Date(row.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
    ;(byDate[date] ??= {})[row.farm_id] = ((byDate[date] ??= {})[row.farm_id] ?? 0) + 1
  }
  return byDate
}

/**
 * 하루치를 한 번에 저장한다.
 *
 * 칸을 고칠 때마다 쓰지 않고 저장 버튼을 눌렀을 때 몰아서 쓴다. 중간 상태가
 * DB 에 남지 않고, 사용자가 되돌리기 쉬워진다.
 */
export async function saveDay(
  date: string,
  day: HistoryDay,
  farms: HistoryFarm[],
  farmProducts: Record<string, { id: string; name: string }[]>,
): Promise<string | null> {
  const cellRows = farms.flatMap((farm) =>
    CHANNELS.map((channel) => {
      const cell = day.cells[farm.id]?.[channel] ?? emptyCell()
      return {
        entry_date: date, farm_id: farm.id, channel,
        count: cell.count, receipt_text: cell.receiptText || null,
      }
    }),
  )
  const productRows = farms.flatMap((farm) => {
    const qty = day.productQty[farm.id] ?? {}
    const nameOf = new Map((farmProducts[farm.id] ?? []).map((p) => [p.id, p.name]))
    // 화면 키는 상품 id 지만 저장은 이름으로 한다. 상품이 지워져도 이력이 남아야 한다.
    // 이름 키(지워진 상품)와 id 키가 같은 이름이 되면 한 upsert 에 같은 행이 두 번 들어가
    // "ON CONFLICT DO UPDATE command cannot affect row a second time" 이 난다. 이름별로 합친다.
    const byName = new Map<string, number>()
    for (const [key, quantity] of Object.entries(qty)) {
      const name = nameOf.get(key) ?? key
      byName.set(name, (byName.get(name) ?? 0) + quantity)
    }
    return [...byName].map(([product_name, quantity]) => ({
      entry_date: date, farm_id: farm.id, product_name, quantity,
    }))
  })

  const cells = await supabase.from('shipping_history')
    .upsert(cellRows, { onConflict: 'entry_date,farm_id,channel' })
  if (cells.error) return cells.error.message
  if (productRows.length > 0) {
    const products = await supabase.from('shipping_history_products')
      .upsert(productRows, { onConflict: 'entry_date,farm_id,product_name' })
    if (products.error) return products.error.message
  }
  return null
}
