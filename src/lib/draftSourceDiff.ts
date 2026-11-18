export type SourceDiffLine = {
  field: string
  original: string
  current: string
}

export type DraftSourceInput = {
  recipientName: string
  phone: string
  address: string
  addressDetail: string
  zonecode: string
  product: string
  productQuery: string
  quantity: number
  senderName: string
  senderPhone: string
  depositorName?: string
  memo: string
  highlight: Partial<Record<string, string>>
}

export type DraftSourceDiffRow = SourceDiffLine & {
  date: string
  index: number
  recipientName: string
}

const STORAGE_KEY = 'farmassi:order-source-diff-csv'
export const ORDER_SOURCE_DIFF_CSV_NAME = 'order-source-diff.csv'

function oneLine(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function pair(field: string, original: string, current: string): SourceDiffLine | null {
  const from = oneLine(original)
  const to = oneLine(current)
  if (!from || from === to) return null
  return { field, original: from, current: to || '(없음)' }
}

function currentAddress(draft: DraftSourceInput) {
  const base = draft.zonecode ? `[${draft.zonecode}] ${draft.address}` : draft.address
  return [base, draft.addressDetail].filter((part) => part.trim()).join(' ')
}

function currentProduct(draft: DraftSourceInput) {
  const name = draft.product.trim()
  if (!name) return ''
  return draft.quantity > 1 ? `${name} × ${draft.quantity}` : name
}

function csvCell(value: string) {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function todayStamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/** 원문 하이라이트·상품 원문과 추출 결과가 조금이라도 다르면 남긴다. */
export function diffDraftSource(draft: DraftSourceInput): SourceDiffLine[] {
  const hi = draft.highlight
  return [
    pair('수령인', hi.recipientName ?? '', draft.recipientName),
    pair('연락처', hi.phone ?? '', draft.phone),
    pair('주소', hi.address ?? '', currentAddress(draft)),
    pair('상품', hi.product || draft.productQuery, currentProduct(draft)),
    pair('보내는분', hi.senderName ?? '', draft.senderName),
    pair('보내는전화', hi.senderPhone ?? '', draft.senderPhone),
    pair('입금자', hi.depositorName ?? '', draft.depositorName ?? ''),
    pair('요청사항', hi.memo ?? '', draft.memo),
  ].filter((row): row is SourceDiffLine => Boolean(row))
}

export function buildDraftSourceDiffCsv(rows: DraftSourceDiffRow[]): string {
  const lines = ['날짜,주문,수령인,필드,원래,이후']
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.date),
        String(row.index),
        csvCell(row.recipientName),
        csvCell(row.field),
        csvCell(row.original),
        csvCell(row.current),
      ].join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

function loadStoredRows(): DraftSourceDiffRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as DraftSourceDiffRow[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveStoredRows(rows: DraftSourceDiffRow[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
}

function downloadCsv(rows: DraftSourceDiffRow[]) {
  const blob = new Blob([`\uFEFF${buildDraftSourceDiffCsv(rows)}`], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = ORDER_SOURCE_DIFF_CSV_NAME
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 변경분을 날짜와 함께 한 CSV에 이어 붙이고 `order-source-diff.csv` 로 내려받는다.
 * 변경이 없으면 아무 것도 하지 않는다.
 */
export function appendAndDownloadDraftSourceDiffCsv(
  rows: Array<Omit<DraftSourceDiffRow, 'date'>>,
  now = new Date(),
) {
  if (rows.length === 0) return false
  const dated = rows.map((row) => ({ ...row, date: todayStamp(now) }))
  const next = [...loadStoredRows(), ...dated]
  saveStoredRows(next)
  downloadCsv(next)
  return true
}
