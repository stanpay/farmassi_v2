import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  autoCountFarmassi, loadFarms, loadFarmProducts, loadMonth, saveDay,
  type HistoryFarm,
} from '../../lib/shippingHistory'
import { loadDemoFarmOrders } from '../../lib/demoFarmOrders'
import { isSundayYmd, shortHolidayName, useHolidays } from '../../lib/useHolidays'
import { useUnsavedGuard } from '../../lib/useUnsavedGuard'
import {
  Pencil,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Minus,
  Plus,
} from 'lucide-react'
import { AppShell } from '../../components/layout/AppShell'
import { Header } from '../../components/layout/Header'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { adminNavItems } from '../../config/adminNav'
import { pauseCovering, todayInSeoul, type PauseRange } from '../../lib/deliveryEstimate'
import { supabase } from '../../lib/supabase'
import { WEEKDAYS, deliveryDaysLabel, writeDaysLabel } from '../../lib/deliveryDays'
import { formatPrice } from '../../lib/format'

/** 송장 대행 1건당 수익 (원) */
const FEE_PER_SHIPMENT = 500

/** 접수 채널 — 엑셀 행과 동일. 관리자 화면 기준. */
const CHANNELS = ['직접연락', '카톡 비즈니스', '팜어시'] as const
type Channel = (typeof CHANNELS)[number]

/** 농가 화면에서는 카톡 비즈니스를 직접연락에 합쳐 숨긴다. */
const FARM_CHANNELS = ['직접연락', '팜어시'] as const satisfies readonly Channel[]

const AUTO_CHANNEL: Channel = '팜어시'
const KAKAO_CHANNEL: Channel = '카톡 비즈니스'
const DIRECT_CHANNEL: Channel = '직접연락'

interface FarmCell {
  count: number
  /** 간편사전접수 접수번호 (쉼표·공백 구분, 입력 원문 유지) */
  receiptText: string
}

interface DayRecord {
  date: string
  cells: Record<string, Record<Channel, FarmCell>>
  /** 농원별 품목 건수. 합계는 그날 해당 농원 송장 건수를 넘을 수 없다. */
  productQty: Record<string, Record<string, number>>
}

const emptyCell = (): FarmCell => ({ count: 0, receiptText: '' })

function emptyFarmCells(): Record<Channel, FarmCell> {
  return {
    직접연락: emptyCell(),
    '카톡 비즈니스': emptyCell(),
    팜어시: emptyCell(),
  }
}

/** 절대 실데이터/API 연동하지 않음. 화면 확인용 더미만. */

/** 팔린 물건: 기본으로 보이는 상위 품목 수 */
const VISIBLE_PRODUCT_LIMIT = 3

/** 농원별 판매 품목 더미 */

/** 판매 건수 많은 순. 동점이면 카탈로그 순서 유지 */
function sortProductsByQty<T extends { id: string }>(
  products: T[],
  qtyMap: Record<string, number>,
): T[] {
  return products
    .map((p, index) => ({ p, index, qty: qtyMap[p.id] ?? 0 }))
    .sort((a, b) => b.qty - a.qty || a.index - b.index)
    .map(({ p }) => p)
}

function emptyProductQty(
  farms: HistoryFarm[],
  farmProducts: Record<string, { id: string; name: string }[]>,
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    farms.map((farm) => [
      farm.id,
      Object.fromEntries((farmProducts[farm.id] ?? []).map((p) => [p.name, 0])),
    ]),
  )
}

function productQtySum(qty: Record<string, number> | undefined): number {
  if (!qty) return 0
  return Object.values(qty).reduce((sum, n) => sum + n, 0)
}

function clampFarmProductQty(
  qty: Record<string, number>,
  maxTotal: number,
): Record<string, number> {
  const next = { ...qty }
  let sum = productQtySum(next)
  if (sum <= maxTotal) return next
  // 초과분만큼 뒤에서부터 깎는다
  for (const id of Object.keys(next).reverse()) {
    if (sum <= maxTotal) break
    const cut = Math.min(next[id], sum - maxTotal)
    next[id] -= cut
    sum -= cut
  }
  return next
}

function createEmptyDay(
  date: string,
  farms: HistoryFarm[] = [],
  farmProducts: Record<string, { id: string; name: string }[]> = {},
): DayRecord {
  return {
    date,
    cells: Object.fromEntries(farms.map((f) => [f.id, emptyFarmCells()])),
    productQty: emptyProductQty(farms, farmProducts),
  }
}


function farmDayTotal(
  cells: Record<Channel, FarmCell> | undefined,
  channels: readonly Channel[] = CHANNELS,
): number {
  // 농가가 아직 안 읽혔거나 새로 생긴 농가면 칸이 없다. 없으면 0 으로 본다 —
  // 여기서 터지면 페이지 전체가 흰 화면이 된다.
  if (!cells) return 0
  return channels.reduce((sum, ch) => sum + (cells[ch]?.count ?? 0), 0)
}

/** 농가 화면용: 카톡 비즈니스 건수·접수번호를 직접연락에 합친다. */
function mergeKakaoIntoDirect(day: DayRecord, farmIds: string[]): DayRecord {
  const cells = { ...day.cells }
  for (const farmId of farmIds) {
    const farmCells = cells[farmId]
    if (!farmCells) continue
    const kakao = farmCells[KAKAO_CHANNEL] ?? emptyCell()
    if (!kakao.count && !kakao.receiptText) {
      cells[farmId] = { ...farmCells, [KAKAO_CHANNEL]: emptyCell() }
      continue
    }
    const direct = farmCells[DIRECT_CHANNEL] ?? emptyCell()
    const receiptParts = [direct.receiptText, kakao.receiptText].map((s) => s.trim()).filter(Boolean)
    cells[farmId] = {
      ...farmCells,
      [DIRECT_CHANNEL]: {
        count: direct.count + kakao.count,
        receiptText: receiptParts.join(', '),
      },
      [KAKAO_CHANNEL]: emptyCell(),
    }
  }
  return { ...day, cells }
}

/**
 * 세션 더미 주문 → 팜어시 자동 건수·팔린 물건.
 * created_at 서울 날짜 기준. 사람이 이미 적은 값은 덮지 않는다.
 */
function applyDemoFarmassi(
  byDate: Map<string, DayRecord>,
  farms: HistoryFarm[],
  farmProducts: Record<string, { id: string; name: string }[]>,
  monthPrefix: string,
  /** 주면 더미 주문을 전부 이 날짜에 넣는다 (농가 화면·오늘). */
  forceDate?: string,
): Record<string, { id: string; name: string }[]> {
  const nextProducts = { ...farmProducts }
  for (const farm of farms) {
    const demos = loadDemoFarmOrders(farm.id)
    if (demos.length === 0) continue

    const productList = [...(nextProducts[farm.id] ?? [])]
    const ensureProduct = (name: string) => {
      if (productList.some((p) => p.id === name || p.name === name)) return name
      productList.push({ id: name, name })
      return name
    }

    const byDayOrders = new Map<string, ReturnType<typeof loadDemoFarmOrders>>()
    for (const order of demos) {
      const date = forceDate
        ?? new Date(order.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
      if (!date.startsWith(monthPrefix)) continue
      const list = byDayOrders.get(date) ?? []
      list.push(order)
      byDayOrders.set(date, list)
    }

    for (const [date, orders] of byDayOrders) {
      const day = byDate.get(date) ?? createEmptyDay(date, farms, nextProducts)
      const cells = (day.cells[farm.id] ??= emptyFarmCells())
      if (cells[AUTO_CHANNEL].count === 0) {
        cells[AUTO_CHANNEL] = { count: orders.length, receiptText: '' }
      }
      const qty = { ...(day.productQty[farm.id] ?? {}) }
      if (productQtySum(qty) === 0) {
        for (const order of orders) {
          for (const item of order.order_items ?? []) {
            const name = (item.product_name || '기타').trim()
            const key = ensureProduct(name)
            qty[key] = (qty[key] ?? 0) + (item.quantity ?? 0)
          }
        }
        day.productQty = {
          ...day.productQty,
          [farm.id]: clampFarmProductQty(qty, farmDayTotal(cells)),
        }
      }
      day.cells = { ...day.cells, [farm.id]: cells }
      byDate.set(date, day)
    }
    nextProducts[farm.id] = productList
  }
  return nextProducts
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()].label
  return `${y}.${m}.${d}. (${weekday})`
}

/**
 * 이 날짜에 이 농가의 이력을 적을 수 있는가.
 *
 * 이력은 물건이 나가기 전날 적는다. 그래서 그날이 배송 요일인지가 아니라
 * '다음날' 이 배송 요일인지를 본다. 월·수·금 배송이면 일·화·목에 적는다.
 */
function farmWritableOn(
  farm: HistoryFarm,
  iso: string,
  pauses: PauseRange[] = [],
): boolean {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(y, m - 1, d + 1)
  const nextIso = ymd(next.getFullYear(), next.getMonth() + 1, next.getDate())

  // 나가는 날이 정지 기간이면 적을 것도 없다.
  if (pauseCovering(pauses, nextIso)) return false

  // 배송 요일을 정하지 않은 농가는 제한이 없는 것으로 본다. 빈 배열을
  // '아무 요일도 안 됨' 으로 읽으면 그 농가는 이력을 아예 적을 수 없다.
  if (farm.deliveryDays.length === 0) return true
  return farm.deliveryDays.includes(next.getDay())
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function shiftMonth(year: number, month: number, delta: number) {
  const next = new Date(year, month - 1 + delta, 1)
  return { year: next.getFullYear(), month: next.getMonth() + 1 }
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function ymd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dayHasWork(day: DayRecord, farms: HistoryFarm[]): boolean {
  return farms.some((farm) => farmDayTotal(day.cells[farm.id]) > 0)
}

/** 화면의 월별 표를 그대로 엑셀로 내려받는다. */
async function downloadMonthExcel(
  year: number,
  month: number,
  monthDays: DayRecord[],
  farms: HistoryFarm[],
  /** 파일 이름에 붙일 농가 이름. 전체를 받을 때는 빈 문자열. */
  farmLabel = '',
  channels: readonly Channel[] = CHANNELS,
) {
  if (monthDays.length === 0) throw new Error('다운로드할 이력이 없습니다.')

  const { Workbook } = await import('exceljs')
  const workbook = new Workbook()
  workbook.creator = 'farmassi'
  const sheet = workbook.addWorksheet(`${year}년 ${month}월`)

  const header = ['채널', ...farms.flatMap((f) => [f.name, '접수번호']), '총합계']
  sheet.addRow(header)

  const sorted = [...monthDays].sort((a, b) => a.date.localeCompare(b.date))
  for (const day of sorted) {
    const [y, m, d] = day.date.split('-').map(Number)
    sheet.addRow([`${y}.${m}.${d}.`, ...farms.flatMap(() => ['', '']), ''])

    for (const channel of channels) {
      const dayGrand = farms.reduce(
        (sum, farm) => sum + farmDayTotal(day.cells[farm.id], channels),
        0,
      )
      const row: (string | number)[] = [channel]
      for (const farm of farms) {
        const cell = day.cells[farm.id]?.[channel] ?? emptyCell()
        row.push(cell.count || '', cell.receiptText || '')
      }
      row.push(channel === AUTO_CHANNEL ? dayGrand || '' : '')
      sheet.addRow(row)
    }

    const totals: (string | number)[] = ['합계']
    let dayGrand = 0
    for (const farm of farms) {
      const total = farmDayTotal(day.cells[farm.id])
      dayGrand += total
      totals.push(total, '')
    }
    totals.push(dayGrand)
    sheet.addRow(totals)
    sheet.addRow([])
  }

  sheet.getColumn(1).width = 14
  farms.forEach((_, i) => {
    sheet.getColumn(2 + i * 2).width = 8
    sheet.getColumn(3 + i * 2).width = 28
  })
  sheet.getColumn(2 + farms.length * 2).width = 10

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `송장대행이력${farmLabel ? `_${farmLabel}` : ''}_${year}-${String(month).padStart(2, '0')}.xlsx`
  link.click()
  URL.revokeObjectURL(url)
}

const countInputClass =
  'w-12 rounded-lg border border-gray-200 bg-white px-1.5 py-1.5 text-center text-sm tabular-nums outline-none focus:border-primary focus:ring-1 focus:ring-primary'
const receiptInputClass =
  'w-full min-w-[10rem] rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-muted outline-none focus:border-primary focus:ring-1 focus:ring-primary'

/**
 * 배송이력 본문.
 *
 * 관리자는 전체 농가, 농가 워크스페이스는 scopedFarm 한 곳만 본다.
 * AppShell 은 호출 쪽에서 감싼다 — 농가 레이아웃이 이미 셸을 쓰고 있다.
 */
export function ShippingHistoryContent({
  scopedFarm,
  backTo,
}: {
  scopedFarm?: HistoryFarm
  backTo: string
}) {
  const today = todayInSeoul()
  const singleFarm = Boolean(scopedFarm)
  /** 농가 페이지: 카톡 비즈니스 행 숨김. 관리자는 전체 채널. */
  const visibleChannels: readonly Channel[] = singleFarm ? FARM_CHANNELS : CHANNELS
  const scopedFarmId = scopedFarm?.id
  // 실데이터. 더미 상수는 첫 로딩 전 잠깐만 쓰인다.
  const [farms, setFarms] = useState<HistoryFarm[]>(scopedFarm ? [scopedFarm] : [])
  const [farmProducts, setFarmProducts] = useState<Record<string, { id: string; name: string }[]>>({})
  const [loadError, setLoadError] = useState('')
  const [viewYear, setViewYear] = useState(() => Number(today.slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => Number(today.slice(5, 7)))
  const [days, setDays] = useState<DayRecord[]>([])
  /** 과거 일자 중 수정 잠금 해제된 날짜 */
  const [editingDates, setEditingDates] = useState<Set<string>>(() => new Set())
  /** 경고 확인 후 팜어시 수동 수정이 열린 날짜 */
  const [unlockedFarmassi, setUnlockedFarmassi] = useState<Set<string>>(() => new Set())
  const [farmassiUnlockDate, setFarmassiUnlockDate] = useState<string | null>(null)
  /** 요일 외 농원 수동 수정 — `${date}:${farmId}` */
  const [unlockedOffDay, setUnlockedOffDay] = useState<Set<string>>(() => new Set())
  const [offDayUnlockTarget, setOffDayUnlockTarget] = useState<{
    date: string
    farmId: string
    farmName: string
  } | null>(null)
  const [exportBusy, setExportBusy] = useState(false)
  /** 엑셀로 내려받을 농가. 빈 문자열이면 전체. 농가 화면은 자기 농가만. */
  const [exportFarmId, setExportFarmId] = useState(scopedFarm?.id ?? '')
  const [exportError, setExportError] = useState('')
  /** 팔린 물건 전체 펼침 — `${date}:${farmId}` */
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(() => new Set())

  /** 농가별 배송 일시정지 구간 (보고 있는 달과 겹치는 것만) */
  const [pauses, setPauses] = useState<Record<string, PauseRange[]>>({})

  const viewMonthKey = monthKey(viewYear, viewMonth)
  // 달력에 공휴일을 빨갛게 보여준다. 배송 일시정지 달력과 같은 훅을 쓴다.
  const holidays = useHolidays(viewYear, viewMonth)
  // loadError 는 아래 헤더 옆에 띄운다

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if (scopedFarm) {
          setFarms([scopedFarm])
          setExportFarmId(scopedFarm.id)
          const p = await loadFarmProducts()
          if (!alive) return
          setFarmProducts({ [scopedFarm.id]: p[scopedFarm.id] ?? [] })
          return
        }
        const [f, p] = await Promise.all([loadFarms(), loadFarmProducts()])
        if (!alive) return
        setFarms(f)
        setFarmProducts(p)
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : '농가를 불러오지 못했습니다.')
      }
    })()
    return () => { alive = false }
  }, [scopedFarmId, scopedFarm])

  // 보고 있는 달과 겹치는 정지 구간만 가져온다. 지난 달을 볼 수도 있어서
  // '오늘 이후' 로 자르면 안 된다.
  useEffect(() => {
    let alive = true
    void (async () => {
      const first = `${viewMonthKey}-01`
      const last = ymd(viewYear, viewMonth, daysInMonth(viewYear, viewMonth))
      let query = supabase
        .from('shipping_pauses')
        .select('farm_id, start_date, end_date, reason')
        .lte('start_date', last)
        .gte('end_date', first)
      if (scopedFarmId) query = query.eq('farm_id', scopedFarmId)
      const { data } = await query
      if (!alive) return
      const byFarm: Record<string, PauseRange[]> = {}
      for (const row of (data ?? []) as any[]) {
        (byFarm[row.farm_id] ??= []).push(row)
      }
      setPauses(byFarm)
    })()
    return () => { alive = false }
  }, [viewYear, viewMonth, viewMonthKey, scopedFarmId])

  // 달을 옮길 때마다 그 달 이력을 읽는다. 팜어시 채널은 저장된 값이 없으면
  // 주문 수로 채운다 — 사람이 고친 값은 덮지 않는다.
  useEffect(() => {
    if (farms.length === 0) return
    let alive = true

    // API 가 느리거나 죽어도 1일~오늘 카드는 바로 깐다. 안 그러면
    // '이력이 없습니다' 만 보이고 관리자 화면처럼 입력할 수 없다.
    const seed = new Map<string, DayRecord>()
    if (`${viewMonthKey}-01` <= today) {
      const lastDay = Math.min(
        daysInMonth(viewYear, viewMonth),
        today.startsWith(viewMonthKey) ? Number(today.slice(8)) : daysInMonth(viewYear, viewMonth),
      )
      for (let d = 1; d <= lastDay; d += 1) {
        const date = ymd(viewYear, viewMonth, d)
        if (date > today) break
        seed.set(date, createEmptyDay(date, farms, farmProducts))
      }
    }

    // 농가 화면: 세션 더미 주문을 오늘 팜어시·팔린 물건에 바로 넣는다.
    let productsForSeed = farmProducts
    if (singleFarm) {
      productsForSeed = applyDemoFarmassi(seed, farms, farmProducts, viewMonthKey, today)
      const farmIds = farms.map((f) => f.id)
      for (const [date, day] of [...seed.entries()]) {
        seed.set(date, mergeKakaoIntoDirect(day, farmIds))
      }
    }
    setDays([...seed.values()].sort((a, b) => b.date.localeCompare(a.date)))

    void (async () => {
      try {
        const [saved, auto] = await Promise.all([
          loadMonth(viewYear, viewMonth, farms, productsForSeed),
          autoCountFarmassi(viewYear, viewMonth),
        ])
        if (!alive) return
        const byDate = new Map(seed)
        const farmIdsList = farms.map((f) => f.id)
        const farmIds = new Set(farmIdsList)
        for (const day of saved) {
          byDate.set(day.date, singleFarm ? mergeKakaoIntoDirect(day, farmIdsList) : day)
        }
        for (const [date, perFarm] of Object.entries(auto)) {
          if (!date.startsWith(viewMonthKey)) continue
          const day = byDate.get(date) ?? createEmptyDay(date, farms, productsForSeed)
          for (const [farmId, count] of Object.entries(perFarm)) {
            if (!farmIds.has(farmId)) continue
            const cells = (day.cells[farmId] ??= emptyFarmCells())
            if (cells[AUTO_CHANNEL].count === 0) cells[AUTO_CHANNEL] = { count, receiptText: '' }
          }
          byDate.set(date, singleFarm ? mergeKakaoIntoDirect(day, farmIdsList) : day)
        }
        if (singleFarm) {
          applyDemoFarmassi(byDate, farms, productsForSeed, viewMonthKey, today)
          for (const [date, day] of [...byDate.entries()]) {
            byDate.set(date, mergeKakaoIntoDirect(day, farmIdsList))
          }
        }
        setDays([...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)))
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : '이력을 불러오지 못했습니다.')
      }
    })()
    return () => { alive = false }
  }, [farms, farmProducts, viewYear, viewMonth, viewMonthKey, today, singleFarm])

  // 오늘이 속한 달로 맞춰 둔다 (월이 바뀌면 새 페이지)
  useEffect(() => {
    setViewYear(Number(today.slice(0, 4)))
    setViewMonth(Number(today.slice(5, 7)))
  }, [today])

  const monthDays = useMemo(
    () => days.filter((d) => d.date.startsWith(viewMonthKey)),
    [days, viewMonthKey],
  )

  const daysByDate = useMemo(
    () => Object.fromEntries(days.map((d) => [d.date, d])),
    [days],
  )

  /**
   * 날짜별 정지 막대.
   *
   * 연속한 칸이 이어져 보여야 하므로 시작·끝 칸만 둥글게 깎고 가운데는
   * 각지게 둔다. 농원 이름은 시작 칸과 주가 바뀌는 일요일에만 적는다 —
   * 매 칸에 적으면 이름이 잘려서 읽을 수가 없다.
   */
  const pauseBars = useMemo(() => {
    const byDate: Record<string, { farmId: string; farmName: string; start: boolean; end: boolean; label: string }[]> = {}
    const count = daysInMonth(viewYear, viewMonth)
    for (const farm of farms) {
      for (const pause of pauses[farm.id] ?? []) {
        for (let d = 1; d <= count; d += 1) {
          const date = ymd(viewYear, viewMonth, d)
          if (date < pause.start_date || date > pause.end_date) continue
          const start = date === pause.start_date
          const weekStart = new Date(viewYear, viewMonth - 1, d).getDay() === 0
          ;(byDate[date] ??= []).push({
            farmId: farm.id,
            farmName: farm.name,
            start,
            end: date === pause.end_date,
            label: start || weekStart ? farm.name : '',
          })
        }
      }
    }
    return byDate
  }, [farms, pauses, viewYear, viewMonth])

  const calendarCells = useMemo(() => {
    const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay()
    const count = daysInMonth(viewYear, viewMonth)
    const blanks = Array.from({ length: firstWeekday }, () => null as string | null)
    const dates = Array.from({ length: count }, (_, i) => ymd(viewYear, viewMonth, i + 1))
    return [...blanks, ...dates]
  }, [viewYear, viewMonth])

  /** 저장할 때 최신 상태를 보기 위한 참조 */
  const daysRef = useRef<DayRecord[]>([])
  useEffect(() => {
    daysRef.current = days
  }, [days])

  /** 아직 저장하지 않은 날짜 */
  const [dirtyDates, setDirtyDates] = useState<Set<string>>(() => new Set())
  const [savingDate, setSavingDate] = useState<string | null>(null)

  function markDirty(date: string) {
    setDirtyDates((prev) => (prev.has(date) ? prev : new Set(prev).add(date)))
  }

  async function saveDate(date: string): Promise<boolean> {
    // days 를 클로저로 읽으면 방금 누른 값이 빠질 수 있다. ref 로 최신 상태를 본다.
    const day = daysRef.current.find((d) => d.date === date)
    if (!day) return false
    setSavingDate(date)
    setLoadError('')
    const err = await saveDay(date, day, farms, farmProducts, visibleChannels)
    setSavingDate(null)
    if (err) {
      setLoadError(`저장하지 못했습니다: ${err}`)
      return false
    }
    setDirtyDates((prev) => {
      const next = new Set(prev)
      next.delete(date)
      return next
    })
    return true
  }

  // 저장하지 않은 값이 있으면 떠나기 전에 물어본다.
  useUnsavedGuard(dirtyDates.size > 0)

  function isEditable(date: string): boolean {
    return date === today || editingDates.has(date)
  }

  function isFarmassiEditable(date: string): boolean {
    return isEditable(date) && unlockedFarmassi.has(date)
  }

  function offDayKey(date: string, farmId: string) {
    return `${date}:${farmId}`
  }

  function isOffDayUnlocked(date: string, farmId: string): boolean {
    return unlockedOffDay.has(offDayKey(date, farmId))
  }

  function toggleEdit(date: string) {
    const locking = editingDates.has(date)
    setEditingDates((prev) => {
      const next = new Set(prev)
      if (locking) next.delete(date)
      else next.add(date)
      return next
    })
    if (locking) {
      setUnlockedFarmassi((prev) => {
        const next = new Set(prev)
        next.delete(date)
        return next
      })
      setUnlockedOffDay((prev) => {
        const next = new Set(prev)
        for (const key of prev) {
          if (key.startsWith(`${date}:`)) next.delete(key)
        }
        return next
      })
    }
  }

  function confirmFarmassiUnlock() {
    if (!farmassiUnlockDate) return
    setUnlockedFarmassi((prev) => new Set(prev).add(farmassiUnlockDate))
    setFarmassiUnlockDate(null)
  }

  function confirmOffDayUnlock() {
    if (!offDayUnlockTarget) return
    setUnlockedOffDay((prev) =>
      new Set(prev).add(offDayKey(offDayUnlockTarget.date, offDayUnlockTarget.farmId)),
    )
    setOffDayUnlockTarget(null)
  }

  function updateCell(date: string, farmId: string, channel: Channel, next: FarmCell) {
    markDirty(date)
    setDays((prev) =>
      prev.map((day) => {
        if (day.date !== date) return day
        const cells = {
          ...day.cells,
          [farmId]: {
            ...day.cells[farmId],
            [channel]: next,
          },
        }
        const maxTotal = farmDayTotal(cells[farmId])
        return {
          ...day,
          cells,
          productQty: {
            ...day.productQty,
            [farmId]: clampFarmProductQty(day.productQty[farmId] ?? {}, maxTotal),
          },
        }
      }),
    )
  }

  function bumpProductQty(date: string, farmId: string, productId: string, delta: number) {
    // markDirty 는 업데이터 밖에서 부른다. setDays 안에서 다른 setState 를 부르면
    // React 가 업데이터를 두 번 실행할 때(StrictMode) 상태가 어긋난다.
    markDirty(date)
    setDays((prev) =>
      prev.map((day) => {
        if (day.date !== date) return day
        const current = { ...(day.productQty[farmId] ?? {}) }
        const allocated = productQtySum(current)
        const value = current[productId] ?? 0
        const maxTotal = farmDayTotal(day.cells[farmId])
        if (delta > 0 && allocated >= maxTotal) return day
        if (delta < 0 && value <= 0) return day
        current[productId] = Math.max(0, value + delta)
        return {
          ...day,
          productQty: { ...day.productQty, [farmId]: current },
        }
      }),
    )
  }

  const farmTotals = useMemo(
    () =>
      farms.map((farm) => ({
        farm,
        total: monthDays.reduce((sum, day) => sum + farmDayTotal(day.cells[farm.id]), 0),
      })),
    [monthDays],
  )
  const grandTotal = farmTotals.reduce((sum, row) => sum + row.total, 0)

  function goMonth(delta: number) {
    const next = shiftMonth(viewYear, viewMonth, delta)
    setViewYear(next.year)
    setViewMonth(next.month)
  }

  function scrollToDay(date: string) {
    const el = document.getElementById(`shipping-day-${date}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function handleExcelDownload() {
    setExportError('')
    setExportBusy(true)
    try {
      // 농가를 고르면 그 농가 칸만 담는다. 정산은 농가별로 하기 때문이다.
      const picked = exportFarmId ? farms.filter((f) => f.id === exportFarmId) : farms
      if (picked.length === 0) throw new Error('농가를 찾지 못했습니다.')
      await downloadMonthExcel(
        viewYear, viewMonth, monthDays, picked,
        exportFarmId ? picked[0].name : '',
        visibleChannels,
      )
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '엑셀을 만들지 못했습니다.')
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <>
      <Header
        title="배송이력 관리"
        subtitle={
          singleFarm && scopedFarm
            ? `${scopedFarm.name} · ${viewYear}년 ${viewMonth}월`
            : `${viewYear}년 ${viewMonth}월`
        }
        showBack
        backTo={backTo}
      />
      <div className="px-4 py-4 md:px-6 max-w-6xl mx-auto space-y-4">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => goMonth(-1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100"
              aria-label="이전 달"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <p className="font-semibold text-gray-900">
              {viewYear}년 {viewMonth}월
            </p>
            <button
              type="button"
              onClick={() => goMonth(1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100"
              aria-label="다음 달"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-muted">
            {WEEKDAYS.map((day) => (
              <div key={day.value} className={`py-1 ${day.value === 0 ? 'text-red-500' : ''}`}>
                {day.label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarCells.map((date, index) => {
              if (!date) return <div key={`blank-${index}`} className="h-11" />
              const record = daysByDate[date]
              const hasWork = record ? dayHasWork(record, farms) : false
              const isToday = date === today
              const holidayName = holidays[date]
              // 공휴일과 일요일은 우체국이 쉬는 날이라 같은 색으로 묶는다.
              const restDay = Boolean(holidayName) || isSundayYmd(date)
              const clickable = Boolean(record)
              const bars = pauseBars[date] ?? []
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!clickable}
                  onClick={() => scrollToDay(date)}
                  title={
                    [holidayName, ...bars.map((b) => `${b.farmName} 배송 일시정지`)]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                  className={[
                    'relative flex h-14 w-full flex-col items-center justify-start gap-0.5 rounded-xl pt-1.5 text-sm leading-none',
                    clickable ? 'hover:bg-primary-light/60' : 'cursor-default',
                    isToday ? 'font-semibold text-primary' : restDay ? 'text-red-600' : 'text-gray-800',
                    !clickable && !isToday && !restDay ? 'text-gray-300' : '',
                    !clickable && restDay && !isToday ? 'text-red-300' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span>{Number(date.slice(8))}</span>
                  {holidayName && (
                    <span className="mt-0.5 max-w-full truncate text-[9px] font-normal">
                      {shortHolidayName(holidayName)}
                    </span>
                  )}
                  {hasWork && <span className="h-1 w-1 rounded-full bg-primary" />}
                  {bars.length > 0 && (
                    <span className="absolute inset-x-0 bottom-0.5 flex flex-col gap-px">
                      {bars.slice(0, 2).map((bar) => (
                        <span
                          key={`${bar.farmId}-${date}`}
                          className={[
                            'h-3 truncate bg-amber-200 px-1 text-[8px] font-normal leading-3 text-amber-900',
                            bar.start ? 'ml-0.5 rounded-l-full' : '',
                            bar.end ? 'mr-0.5 rounded-r-full' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {bar.label}
                        </span>
                      ))}
                      {bars.length > 2 && (
                        <span className="text-[8px] leading-3 text-amber-800">
                          +{bars.length - 2}
                        </span>
                      )}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted">
            달력에서 월을 바꾸면 해당 월 이력만 보입니다. 점이 있는 날은 작업 기록이 있습니다.
          </p>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            {viewYear}년 {viewMonth}월 송장 대행 이력
          </p>
          <div className="flex items-center gap-2">
            {!singleFarm && (
              <select
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-primary"
                value={exportFarmId}
                onChange={(e) => setExportFarmId(e.target.value)}
                aria-label="엑셀로 내려받을 농가"
              >
                <option value="">전체 농가</option>
                {farms.map((farm) => (
                  <option key={farm.id} value={farm.id}>{farm.name}</option>
                ))}
              </select>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={exportBusy || monthDays.length === 0}
              onClick={() => void handleExcelDownload()}
            >
              <Download className="h-4 w-4" />
              엑셀 다운로드
            </Button>
          </div>
        </div>
        {exportError && <p className="text-sm text-red-600">{exportError}</p>}
        {loadError && <p className="text-sm text-red-600">{loadError}</p>}
        {dirtyDates.size > 0 && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            저장하지 않은 데이터가 있습니다 ({[...dirtyDates].sort().join(', ')}).
            각 날짜의 저장 버튼을 눌러 주세요.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {farmTotals.map(({ farm, total }) => (
            <Card key={farm.id} className="space-y-1">
              <p className="text-sm text-muted">{farm.name}</p>
              <p className="text-2xl font-bold text-gray-900">{total}건</p>
              <p className="text-xs text-muted">
                배송요일 {deliveryDaysLabel(farm.deliveryDays) || '미설정'}
              </p>
              {farm.deliveryDays.length > 0 && (
                <p className="text-xs text-muted">
                  작성요일 {writeDaysLabel(farm.deliveryDays)}
                </p>
              )}
              <p className="text-sm font-semibold text-primary">
                {formatPrice(total * FEE_PER_SHIPMENT)}
              </p>
            </Card>
          ))}
          <Card className="space-y-1 bg-primary-light/40 border-primary/20">
            <p className="text-sm text-muted">{viewMonth}월 합계</p>
            <p className="text-2xl font-bold text-gray-900">{grandTotal}건</p>
            <p className="text-xs text-muted">건당 {formatPrice(FEE_PER_SHIPMENT)}</p>
            <p className="text-sm font-semibold text-primary">
              {formatPrice(grandTotal * FEE_PER_SHIPMENT)}
            </p>
          </Card>
        </div>

        {monthDays.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            {viewYear}년 {viewMonth}월 이력이 없습니다.
          </p>
        )}

        {monthDays.map((day) => {
          const dayGrand = farms.reduce(
            (sum, farm) => sum + farmDayTotal(day.cells[farm.id]),
            0,
          )
          const editable = isEditable(day.date)
          const farmassiOpen = isFarmassiEditable(day.date)
          const isToday = day.date === today
          const isPast = day.date < today
          const dirty = dirtyDates.has(day.date)
          const saving = savingDate === day.date

          return (
            <div key={day.date} id={`shipping-day-${day.date}`} className="scroll-mt-4">
            <Card className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{formatDisplayDate(day.date)}</h3>
                    {isToday && (
                      <span className="rounded-md bg-primary-light px-1.5 py-0.5 text-xs font-medium text-primary">
                        오늘
                      </span>
                    )}
                    {editable && !isToday && (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        수정 중
                      </span>
                    )}
                    {dirty && (
                      <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                        저장 안 됨
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    작성 가능 농원:{' '}
                    {farms.filter((f) => farmWritableOn(f, day.date, pauses[f.id]))
                      .map((f) => f.name)
                      .join(', ') || '없음'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/*
                    과거 날짜를 수정 중일 때는 버튼이 하나면 된다. '수정 완료' 가
                    저장까지 하므로 옆에 '저장' 을 따로 두면 무엇을 눌러야 하는지
                    헷갈린다. 오늘은 잠금이 없어 '저장' 만 나온다.
                  */}
                  {editable && !isPast && (
                    <Button
                      size="sm"
                      variant={dirty ? 'primary' : 'outline'}
                      type="button"
                      disabled={!dirty || saving}
                      onClick={() => void saveDate(day.date)}
                    >
                      <Check className="h-4 w-4" />
                      {saving ? '저장 중…' : '저장'}
                    </Button>
                  )}
                  {isPast && (
                    <Button
                      size="sm"
                      variant={editable ? (dirty ? 'primary' : 'outline') : 'outline'}
                      type="button"
                      disabled={saving}
                      onClick={async () => {
                        // 잠그기 전에 저장한다. 안 그러면 고친 값이 그대로 날아간다.
                        if (editable && dirty && !(await saveDate(day.date))) return
                        toggleEdit(day.date)
                      }}
                    >
                      {editable ? (
                        <>
                          <Check className="h-4 w-4" />
                          {saving ? '저장 중…' : '수정 완료'}
                        </>
                      ) : (
                        <>
                          <Pencil className="h-4 w-4" />
                          수정
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-sm">
                  <colgroup>
                    <col className="w-36" />
                    {farms.flatMap((farm) => [
                      <col key={`${farm.id}-count`} className="w-14" />,
                      <col key={`${farm.id}-receipt`} />,
                    ])}
                    <col className="w-16" />
                  </colgroup>
                  <thead>
                    <tr className="bg-gray-50 text-left text-muted">
                      <th className="px-3 py-2 font-medium">채널</th>
                      {farms.map((farm) => {
                        const canWrite = farmWritableOn(farm, day.date, pauses[farm.id])
                        const offOpen = isOffDayUnlocked(day.date, farm.id)
                        return (
                          <th key={farm.id} className="px-3 py-2 font-medium align-top" colSpan={2}>
                            <div className="flex flex-col gap-1">
                              <span>
                                {farm.name}
                                {!canWrite && (
                                  <span className="ml-1 text-xs font-normal text-amber-700">
                                    (작성일 외)
                                  </span>
                                )}
                              </span>
                              {!canWrite && editable && !offOpen && (
                                <button
                                  type="button"
                                  className="w-fit text-left text-xs font-normal text-primary hover:underline"
                                  onClick={() =>
                                    setOffDayUnlockTarget({
                                      date: day.date,
                                      farmId: farm.id,
                                      farmName: farm.name,
                                    })
                                  }
                                >
                                  수동 수정…
                                </button>
                              )}
                              {!canWrite && offOpen && (
                                <button
                                  type="button"
                                  className="w-fit text-left text-xs font-normal text-muted hover:underline"
                                  onClick={() => {
                                    setUnlockedOffDay((prev) => {
                                      const next = new Set(prev)
                                      next.delete(offDayKey(day.date, farm.id))
                                      return next
                                    })
                                  }}
                                >
                                  다시 잠그기
                                </button>
                              )}
                            </div>
                          </th>
                        )
                      })}
                      <th className="px-3 py-2 font-medium text-right">총합계</th>
                    </tr>
                    <tr className="bg-gray-50/60 text-xs text-muted border-b border-gray-100">
                      <th className="px-3 py-1" />
                      {farms.map((farm) => (
                        <Fragment key={farm.id}>
                          <th className="px-2 py-1 font-normal text-center">건</th>
                          <th className="px-2 py-1 font-normal">접수번호</th>
                        </Fragment>
                      ))}
                      <th className="px-3 py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleChannels.map((channel) => {
                      const isAuto = channel === AUTO_CHANNEL
                      return (
                        <tr
                          key={channel}
                          className={[
                            'border-b border-gray-50',
                            isAuto && 'bg-slate-50/70',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <td className="px-3 py-2 font-medium text-gray-800">
                            <div className="flex flex-col gap-1">
                              <span className="whitespace-nowrap">
                                {channel}
                                {isAuto && (
                                  <span className="ml-1 text-[10px] font-normal text-muted">
                                    자동
                                  </span>
                                )}
                              </span>
                              {isAuto && editable && !farmassiOpen && (
                                <button
                                  type="button"
                                  className="w-fit text-left text-xs font-normal text-primary hover:underline"
                                  onClick={() => setFarmassiUnlockDate(day.date)}
                                >
                                  수동 수정…
                                </button>
                              )}
                              {isAuto && farmassiOpen && (
                                <button
                                  type="button"
                                  className="w-fit text-left text-xs font-normal text-muted hover:underline"
                                  onClick={() => {
                                    setUnlockedFarmassi((prev) => {
                                      const next = new Set(prev)
                                      next.delete(day.date)
                                      return next
                                    })
                                  }}
                                >
                                  자동으로 되돌리기
                                </button>
                              )}
                            </div>
                          </td>
                          {farms.map((farm) => {
                            const cell = day.cells[farm.id]?.[channel] ?? emptyCell()
                            const canWrite = farmWritableOn(farm, day.date, pauses[farm.id])
                            const offOpen = isOffDayUnlocked(day.date, farm.id)
                            const farmOpen = canWrite || offOpen
                            const cellEditable =
                              farmOpen && (isAuto ? farmassiOpen : editable)
                            const muted = !farmOpen ? 'bg-gray-50/80' : ''
                            return (
                              <Fragment key={farm.id}>
                                <td className={`px-2 py-2 align-middle text-center ${muted}`}>
                                  {cellEditable ? (
                                    <input
                                      type="number"
                                      min={0}
                                      inputMode="numeric"
                                      className={countInputClass}
                                      value={cell.count || ''}
                                      placeholder="0"
                                      onChange={(e) => {
                                        const count = Math.max(0, Number(e.target.value) || 0)
                                        updateCell(day.date, farm.id, channel, {
                                          ...cell,
                                          count,
                                        })
                                      }}
                                    />
                                  ) : (
                                    <span className="tabular-nums text-gray-900">
                                      {cell.count || (farmOpen ? '' : '—')}
                                    </span>
                                  )}
                                </td>
                                <td className={`px-2 py-2 align-middle ${muted}`}>
                                  {cellEditable ? (
                                    <input
                                      type="text"
                                      className={receiptInputClass}
                                      value={cell.receiptText}
                                      placeholder="번호, 번호…"
                                      onChange={(e) =>
                                        updateCell(day.date, farm.id, channel, {
                                          ...cell,
                                          receiptText: e.target.value,
                                        })
                                      }
                                    />
                                  ) : (
                                    <span
                                      className="block truncate text-xs text-muted whitespace-nowrap"
                                      title={cell.receiptText}
                                    >
                                      {cell.receiptText || (farmOpen ? '' : '—')}
                                    </span>
                                  )}
                                </td>
                              </Fragment>
                            )
                          })}
                          <td className="px-3 py-2 text-right tabular-nums text-muted">
                            {isAuto ? dayGrand || '' : ''}
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-3 py-2.5">합계</td>
                      {farms.map((farm) => (
                        <Fragment key={farm.id}>
                          <td className="px-2 py-2.5 text-center tabular-nums">
                            {farmDayTotal(day.cells[farm.id])}
                          </td>
                          <td className="px-2 py-2.5" />
                        </Fragment>
                      ))}
                      <td className="px-3 py-2.5 text-right tabular-nums">{dayGrand}</td>
                    </tr>
                    <tr className="border-t border-gray-100">
                      <td className="px-3 py-2.5 align-top text-sm font-medium text-gray-800">
                        팔린 물건
                      </td>
                      {farms.map((farm) => {
                        const target = farmDayTotal(day.cells[farm.id])
                        const qtyMap = day.productQty[farm.id] ?? {}
                        const allocated = productQtySum(qtyMap)
                        const remaining = Math.max(0, target - allocated)
                        const catalog = farmProducts[farm.id] ?? []
                        const products = sortProductsByQty(
                          [
                            ...catalog,
                            ...Object.keys(qtyMap)
                              .filter((id) => !catalog.some((p) => p.id === id))
                              .map((id) => ({ id, name: id })),
                          ],
                          qtyMap,
                        )
                        const productExpandKey = `${day.date}:${farm.id}`
                        const productsExpanded = expandedProducts.has(productExpandKey)
                        const hasMoreProducts = products.length > VISIBLE_PRODUCT_LIMIT
                        const visibleProducts =
                          productsExpanded || !hasMoreProducts
                            ? products
                            : products.slice(0, VISIBLE_PRODUCT_LIMIT)
                        const hiddenCount = products.length - VISIBLE_PRODUCT_LIMIT
                        // 건수를 먼저 받는다. 품목 합계는 건수를 넘을 수 없으므로
                        // 기준이 없으면 몇 개까지 넣을 수 있는지 알 수 없다.
                        const canEditProducts = editable && target > 0
                        const matched = target > 0 && allocated === target
                        return (
                          <td
                            key={farm.id}
                            colSpan={2}
                            className="min-w-[13rem] px-2 py-2.5 align-top"
                          >
                            {target === 0 ? (
                              <span className="text-xs text-muted">
                                {editable ? '건수를 먼저 입력하세요' : '—'}
                              </span>
                            ) : (
                              <div className="space-y-1.5">
                                <p
                                  className={[
                                    'text-[11px] tabular-nums',
                                    matched ? 'text-primary' : 'text-amber-700',
                                  ].join(' ')}
                                >
                                  {allocated}/{target}건
                                  {!matched && remaining > 0 ? ` · ${remaining}건 남음` : ''}
                                  {!matched && remaining === 0 && allocated > target
                                    ? ' · 초과'
                                    : ''}
                                </p>
                                <ul className="space-y-1">
                                  {visibleProducts.map((product) => {
                                    const qty = qtyMap[product.id] ?? 0
                                    return (
                                      <li
                                        key={product.id}
                                        className="flex items-start gap-1.5 text-xs"
                                      >
                                        {/*
                                          긴 상품명을 잘라내면 무엇을 세는지 알 수 없다.
                                          줄바꿈해서 전부 보여준다. break-words 는 공백이
                                          없는 긴 낱말도 끊어 준다.
                                        */}
                                        <span className="min-w-0 flex-1 break-words leading-snug text-gray-700">
                                          {product.name}
                                        </span>
                                        {canEditProducts ? (
                                          <div className="flex shrink-0 items-center gap-0.5">
                                            <button
                                              type="button"
                                              aria-label={`${product.name} 감소`}
                                              disabled={qty <= 0}
                                              onClick={() =>
                                                bumpProductQty(
                                                  day.date,
                                                  farm.id,
                                                  product.id,
                                                  -1,
                                                )
                                              }
                                              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                                            >
                                              <Minus className="h-3 w-3" />
                                            </button>
                                            <span className="w-5 text-center tabular-nums font-medium">
                                              {qty}
                                            </span>
                                            <button
                                              type="button"
                                              aria-label={`${product.name} 증가`}
                                              disabled={remaining <= 0}
                                              onClick={() =>
                                                bumpProductQty(
                                                  day.date,
                                                  farm.id,
                                                  product.id,
                                                  1,
                                                )
                                              }
                                              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                                            >
                                              <Plus className="h-3 w-3" />
                                            </button>
                                          </div>
                                        ) : (
                                          <span className="w-5 shrink-0 text-center tabular-nums text-muted">
                                            {qty || '—'}
                                          </span>
                                        )}
                                      </li>
                                    )
                                  })}
                                </ul>
                                {hasMoreProducts ? (
                                  <button
                                    type="button"
                                    aria-expanded={productsExpanded}
                                    onClick={() =>
                                      setExpandedProducts((prev) => {
                                        const next = new Set(prev)
                                        if (productsExpanded) next.delete(productExpandKey)
                                        else next.add(productExpandKey)
                                        return next
                                      })
                                    }
                                    className="inline-flex items-center gap-0.5 text-[11px] text-muted hover:text-gray-700"
                                  >
                                    {productsExpanded
                                      ? '접기'
                                      : `펼쳐보기 · ${hiddenCount}개`}
                                    <ChevronDown
                                      className={[
                                        'h-3 w-3 transition-transform',
                                        productsExpanded ? 'rotate-180' : '',
                                      ].join(' ')}
                                    />
                                  </button>
                                ) : null}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-3 py-2.5" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={farmassiUnlockDate !== null}
        title="팜어시 값을 수동으로 수정할까요?"
        description={
          <>
            팜어시 건수는 서비스에 접수된 주문을 자동 집계한 값입니다. 수동으로 바꾸면 실제
            접수 현황과 어긋날 수 있습니다. 꼭 필요할 때만 수정하세요.
          </>
        }
        confirmLabel="그래도 수정"
        cancelLabel="취소"
        onConfirm={confirmFarmassiUnlock}
        onCancel={() => setFarmassiUnlockDate(null)}
      />

      <ConfirmDialog
        open={offDayUnlockTarget !== null}
        title="작성일이 아닌 농원을 수정할까요?"
        description={
          <>
            {offDayUnlockTarget?.farmName}은(는) 이날 작성일이 아닙니다 (배송 전날에 적습니다).
            예외적으로 입력하면 일정과 어긋날 수 있습니다. 꼭 필요할 때만 수정하세요.
          </>
        }
        confirmLabel="그래도 수정"
        cancelLabel="취소"
        onConfirm={confirmOffDayUnlock}
        onCancel={() => setOffDayUnlockTarget(null)}
      />
    </>
  )
}

export function AdminShippingHistory() {
  return (
    <AppShell navItems={adminNavItems} roleLabel="관리자" settingsPath="/admin/none">
      <ShippingHistoryContent backTo="/admin/shipments" />
    </AppShell>
  )
}
