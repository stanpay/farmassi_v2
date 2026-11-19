/**
 * 농가별 배송 가능 요일.
 *
 * 번호는 JS 의 Date.getDay() 와 같다 (0=일 … 6=토). 화면에서 변환 없이
 * 그대로 비교하려는 것이다.
 *
 * 빈 배열은 '아직 설정하지 않음' 이지 '배송 안 함' 이 아니다. 설정한 농가만
 * 예상 배송일을 보여주고, 나머지는 지금까지와 똑같이 동작한다.
 */

export const WEEKDAYS = [
  { value: 0, label: '일' },
  { value: 1, label: '월' },
  { value: 2, label: '화' },
  { value: 3, label: '수' },
  { value: 4, label: '목' },
  { value: 5, label: '금' },
  { value: 6, label: '토' },
] as const

export function normalizeDeliveryDays(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const days = value
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  return [...new Set(days)].sort((a, b) => a - b)
}

/**
 * '월, 수, 금' 처럼 요일을 늘어놓는다. 설정이 없으면 빈 문자열.
 *
 * 월~금을 모두 고른 경우는 '평일' 로 묶는다. '월, 화, 수, 목, 금' 은 길기만
 * 하고 읽기 어렵다. 주말이 섞이면 '평일, 토' 처럼 붙인다.
 */
export function deliveryDaysLabel(days: number[]): string {
  const set = new Set(normalizeDeliveryDays(days))
  if (set.size === 0) return ''

  const WEEKDAY_VALUES = [1, 2, 3, 4, 5]
  const allWeekdays = WEEKDAY_VALUES.every((v) => set.has(v))
  if (!allWeekdays) {
    return WEEKDAYS.filter((day) => set.has(day.value)).map((day) => day.label).join(', ')
  }
  // 평일 + 주말 조합. 토·일은 뒤에 붙인다.
  const weekend = WEEKDAYS.filter((day) => (day.value === 6 || day.value === 0) && set.has(day.value))
    .sort((a) => (a.value === 6 ? -1 : 1))
    .map((day) => day.label)
  return ['평일', ...weekend].join(', ')
}

/**
 * 다음 배송일.
 *
 * 오늘도 후보에 넣는다 — 오전에 주문하면 당일 발송될 수 있고, 아니어도
 * '가장 가까운 배송일' 이라는 뜻은 유지된다. 설정이 없으면 null.
 */
export function nextDeliveryDate(days: number[], from = new Date()): Date | null {
  const set = new Set(normalizeDeliveryDays(days))
  if (set.size === 0) return null

  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = new Date(base)
    candidate.setDate(base.getDate() + offset)
    if (set.has(candidate.getDay())) return candidate
  }
  return null
}

/** '8월 26일(화)' */
export function formatDeliveryDate(date: Date): string {
  return `${date.getMonth() + 1}월 ${date.getDate()}일(${WEEKDAYS[date.getDay()].label})`
}

/**
 * 작성 요일 = 배송 요일의 전날.
 *
 * 배송이력은 물건이 나가기 전날 적는다. 월·수·금 배송이면 일·화·목에 적는다.
 * 0=일 이라 -1 하면 음수가 되므로 +6 후 나머지로 돌린다.
 */
export function writeDaysFor(deliveryDays: number[]): number[] {
  const days = normalizeDeliveryDays(deliveryDays).map((day) => (day + 6) % 7)
  return [...new Set(days)].sort((a, b) => a - b)
}

/** '일, 화, 목' — 작성 가능한 요일을 늘어놓는다. 설정이 없으면 빈 문자열. */
export function writeDaysLabel(deliveryDays: number[]): string {
  return deliveryDaysLabel(writeDaysFor(deliveryDays))
}
