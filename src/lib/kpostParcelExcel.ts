import type { Border, Fill, Font, Workbook } from 'exceljs'
import type { OrderRow } from './orders'
import { digitsOnly, formatPhone } from './phone'

export const KPOST_CONTENT_CODES = [
  '농/수/축산물(일반)',
  '농/수/축산물(냉동/냉장)',
  '전자제품',
  '서적',
  '의류/패션잡화',
  '미용/화장품',
  '의료/건강식품',
  '생활용품',
  '기타',
] as const

export const KPOST_WEIGHTS = ['3', '5', '7', '10', '15', '20', '25', '30'] as const
export const KPOST_VOLUMES = ['80', '100', '120', '160'] as const
export const KPOST_DELIVERY_TYPES = ['', '대면', '비대면'] as const


/**
 * 고르는 값은 우체국 요금표의 구간 상한이지만, 화면에는 숫자만 보여준다.
 * '5kg ~ 7kg' 처럼 범위로 적었더니 무엇을 고른 건지 알기 어렵다는 지적을
 * 받았다. 구간별 요금은 폼 위에 표로 따로 보여준다.
 */
export function kpostWeightLabel(value: string) {
  return `${value}kg`
}

export function kpostVolumeLabel(value: string) {
  return `${value}cm`
}

export interface ParcelExcelOptions {
  weightKg: string
  volumeCm: string
  contentCode: string
  deliveryType: string
}

export const defaultParcelExcelOptions: ParcelExcelOptions = {
  weightKg: '5',
  volumeCm: '80',
  contentCode: '농/수/축산물(일반)',
  deliveryType: '',
}

const SHEET_NAME = '창구소포 파일접수양식'
const REQUIRED_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF99CCFF' } }
const OPTIONAL_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFCC' } }
const THIN: Partial<Border> = { style: 'thin', color: { argb: 'FF000000' } }
const HEADER_FONT: Partial<Font> = { name: '맑은 고딕', size: 10, bold: true }
const DATA_FONT: Partial<Font> = { name: '돋움', size: 11 }

const COLUMNS: Array<{
  header: string
  width: number
  required: boolean
}> = [
  { header: '받는 분', width: 10.3, required: true },
  { header: '우편번호', width: 7.3, required: true },
  { header: '주소(시도+시군구+도로명+건물번호)', width: 27.3, required: true },
  { header: '상세주소(동, 호수, 洞명칭, 아파트, 건물명 등)', width: 33.3, required: true },
  { header: '일반전화(02-1234-5678)', width: 20.3, required: false },
  { header: '휴대전화(010-1234-5678)', width: 20.3, required: true },
  { header: '중량(kg)', width: 7.3, required: true },
  { header: '부피(cm)=가로+세로+높이', width: 20.3, required: true },
  { header: '내용품코드', width: 25.6, required: true },
  { header: '내용물', width: 26, required: false },
  { header: '배달방식', width: 9.3, required: false },
  { header: '배송시요청사항', width: 38.4, required: false },
  { header: '분할접수 여부(Y/N)', width: 14.9, required: true },
  { header: '분할접수 첫번째 중량(kg)', width: 19, required: true },
  { header: '분할접수 첫번째 부피(cm)', width: 20.3, required: true },
  { header: '분할접수 두번째 중량(kg)', width: 19, required: true },
  { header: '분할접수 두번째 부피(cm)', width: 20.3, required: true },
]

export function formatParcelPhone(value: string) {
  return formatPhone(value) || value
}

export function formatZonecode(value: string | null | undefined) {
  return digitsOnly(value ?? '').slice(0, 5)
}

export function parcelContents(order: OrderRow) {
  return (order.order_items ?? [])
    .map((item) => (item.quantity > 1 ? `${item.product_name} ${item.quantity}` : item.product_name))
    .join(', ')
}

function itemParcel(order: OrderRow) {
  return (order.order_items ?? []).map((item) => item.product).filter((product) => product != null)
}

export function parcelOptionsFromOrder(order: OrderRow): ParcelExcelOptions {
  const products = itemParcel(order)
  const weights = products.map((product) => Number(product.parcel_weight_kg)).filter((n) => Number.isFinite(n) && n > 0)
  const volumes = products.map((product) => Number(product.parcel_volume_cm)).filter((n) => Number.isFinite(n) && n > 0)
  const deliveryType = products.find((product) => product.parcel_delivery_type)?.parcel_delivery_type ?? ''
  const contentCode =
    products.find((product) => product.parcel_content_code)?.parcel_content_code ?? defaultParcelExcelOptions.contentCode
  return {
    weightKg: String(weights.length ? Math.max(...weights) : Number(defaultParcelExcelOptions.weightKg)),
    volumeCm: String(volumes.length ? Math.max(...volumes) : Number(defaultParcelExcelOptions.volumeCm)),
    contentCode,
    deliveryType,
  }
}

function fileStampParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${get('year')}${get('month')}${get('day')}`,
    time: `${get('hour')}${get('minute')}${get('second')}`,
  }
}

/** 파일명에 쓸 수 없는 문자만 빼고 농가명은 그대로 둔다. */
function sanitizeFarmName(name: string) {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '')
  return cleaned || '농가'
}

function applyHeaderStyle(workbook: Workbook) {
  const sheet = workbook.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.properties.defaultRowHeight = 13.5
  sheet.columns = COLUMNS.map((col) => ({ width: col.width }))

  const header = sheet.getRow(1)
  header.height = 27
  COLUMNS.forEach((col, index) => {
    const cell = header.getCell(index + 1)
    cell.value = col.header
    cell.font = HEADER_FONT
    cell.fill = col.required ? REQUIRED_FILL : OPTIONAL_FILL
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = { left: THIN, right: THIN, top: THIN, bottom: THIN }
  })
  return sheet
}

export function ordersMissingZonecode(orders: OrderRow[]) {
  return orders.filter((order) => formatZonecode(order.zonecode).length !== 5)
}

export async function downloadKpostParcelExcel(orders: OrderRow[], farmName = '농가') {
  if (orders.length === 0) throw new Error('다운로드할 주문이 없습니다.')

  const { Workbook } = await import('exceljs')
  const workbook = new Workbook()
  workbook.creator = 'farmassi'
  const sheet = applyHeaderStyle(workbook)

  orders.forEach((order, index) => {
    const options = parcelOptionsFromOrder(order)
    const row = sheet.getRow(index + 2)
    const values = [
      order.recipient_name,
      formatZonecode(order.zonecode),
      order.address,
      order.address_detail ?? '',
      '',
      formatParcelPhone(order.recipient_phone),
      options.weightKg,
      options.volumeCm,
      options.contentCode,
      parcelContents(order),
      options.deliveryType,
      order.request_memo ?? '',
      'N',
      '',
      '',
      '',
      '',
    ]
    values.forEach((value, col) => {
      const cell = row.getCell(col + 1)
      cell.value = value
      cell.font = DATA_FONT
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.numFmt = '@'
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  const { date, time } = fileStampParts()
  link.download = `farmassi_${sanitizeFarmName(farmName)}_${date}${time}.xlsx`
  link.click()
  URL.revokeObjectURL(url)
}
