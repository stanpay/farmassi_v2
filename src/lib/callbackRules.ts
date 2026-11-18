export const CALL_EVENTS = ['outgoing', 'incoming', 'missed'] as const
export type CallEvent = (typeof CALL_EVENTS)[number]

export const CALL_EVENT_LABEL: Record<CallEvent, string> = {
  outgoing: '발신',
  incoming: '수신',
  missed: '부재중',
}

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  0: '일',
  1: '월',
  2: '화',
  3: '수',
  4: '목',
  5: '금',
  6: '토',
}

export const FREQUENCIES = ['always', 'daily', 'weekly', 'once', 'days'] as const
export type Frequency = (typeof FREQUENCIES)[number]

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  always: '제한 없음 (매번 발송)',
  daily: '번호당 하루에 한 번',
  weekly: '번호당 일주일에 한 번',
  once: '번호당 평생 한 번',
  days: '직접 입력',
}

export interface AutoSmsRule {
  id: string
  name: string
  enabled: boolean
  events: CallEvent[]
  days: Weekday[]
  start: string
  end: string
  frequency: Frequency
  frequencyDays: number
}

export interface AutoSmsExclusion {
  name: string
  phone: string
}

export interface AutoSmsConfig {
  master: boolean
  popupWhenOff: boolean
  message: string
  rules: AutoSmsRule[]
  exclusions: AutoSmsExclusion[]
}

export interface RuleOverlap {
  aId: string
  bId: string
  aName: string
  bName: string
  events: CallEvent[]
  days: Weekday[]
  time: string
}

export const DEFAULT_RULE: AutoSmsRule = {
  id: 'default-missed',
  name: '부재중 전화',
  enabled: true,
  events: ['missed'],
  days: [...WEEKDAYS],
  start: '00:00',
  end: '00:00',
  frequency: 'always',
  frequencyDays: 1,
}

export function defaultAutoSmsConfig(message = ''): AutoSmsConfig {
  return {
    master: false,
    popupWhenOff: true,
    message,
    rules: [{ ...DEFAULT_RULE }],
    exclusions: [],
  }
}

/** DB `farms.auto_sms`. 자동 발신 스위치(master)와 문구는 여기에 넣지 않는다. */
export interface AutoSmsStored {
  popupWhenOff: boolean
  rules: AutoSmsRule[]
  exclusions: AutoSmsExclusion[]
}

export function storedFromConfig(config: AutoSmsConfig): AutoSmsStored {
  return {
    popupWhenOff: config.popupWhenOff,
    rules: config.rules,
    exclusions: config.exclusions,
  }
}

export function parseAutoSmsStored(value: unknown, message = ''): AutoSmsConfig {
  const fallback = defaultAutoSmsConfig(message)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const raw = value as Record<string, unknown>
  const hasRules = Object.prototype.hasOwnProperty.call(raw, 'rules')
  return {
    master: false,
    popupWhenOff: raw.popupWhenOff !== false,
    message,
    rules: Array.isArray(raw.rules) ? (raw.rules as AutoSmsRule[]) : hasRules ? [] : fallback.rules,
    exclusions: Array.isArray(raw.exclusions) ? (raw.exclusions as AutoSmsExclusion[]) : [],
  }
}

export function newRuleId() {
  return crypto.randomUUID()
}

export function emptyRule(): AutoSmsRule {
  return {
    id: newRuleId(),
    name: '',
    enabled: true,
    events: ['missed'],
    days: [...WEEKDAYS],
    start: '00:00',
    end: '00:00',
    frequency: 'always',
    frequencyDays: 1,
  }
}

function parseMinute(hhmm: string) {
  const [h, m] = hhmm.split(':').map((part) => Number(part) || 0)
  return Math.max(0, Math.min(24 * 60 - 1, h * 60 + m))
}

/** 시작과 끝이 같으면 하루 종일, 시작이 더 늦으면 자정을 넘긴다. */
function timeIntervals(start: string, end: string): Array<[number, number]> {
  const a = parseMinute(start)
  const b = parseMinute(end)
  if (a === b) return [[0, 24 * 60]]
  if (a < b) return [[a, b]]
  return [
    [a, 24 * 60],
    [0, b],
  ]
}

function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  for (const [as, ae] of timeIntervals(aStart, aEnd)) {
    for (const [bs, be] of timeIntervals(bStart, bEnd)) {
      if (as < be && bs < ae) return true
    }
  }
  return false
}

function formatWindow(start: string, end: string) {
  if (start === end) return '하루 종일'
  if (parseMinute(start) < parseMinute(end)) return `${start}–${end}`
  return `${start}–다음날 ${end}`
}

export function describeRule(rule: AutoSmsRule) {
  const events = rule.events.map((event) => CALL_EVENT_LABEL[event]).join('·') || '상황 없음'
  const days =
    rule.days.length === 7
      ? '매일'
      : rule.days.length === 5 && rule.days.every((day) => day >= 1 && day <= 5)
        ? '평일'
        : rule.days.length === 2 && rule.days.includes(0) && rule.days.includes(6)
          ? '주말'
          : rule.days.map((day) => WEEKDAY_LABEL[day]).join('')
  const freq =
    rule.frequency === 'days' ? `번호당 ${rule.frequencyDays}일마다 한 번` : FREQUENCY_LABEL[rule.frequency]
  return `${events} · ${days} · ${formatWindow(rule.start, rule.end)} · ${freq}`
}

export function findOverlaps(rules: AutoSmsRule[]): RuleOverlap[] {
  const enabled = rules.filter((rule) => rule.enabled)
  const overlaps: RuleOverlap[] = []
  for (let i = 0; i < enabled.length; i += 1) {
    for (let j = i + 1; j < enabled.length; j += 1) {
      const a = enabled[i]
      const b = enabled[j]
      const events = a.events.filter((event) => b.events.includes(event))
      const days = a.days.filter((day) => b.days.includes(day))
      if (events.length === 0 || days.length === 0) continue
      if (!timesOverlap(a.start, a.end, b.start, b.end)) continue
      overlaps.push({
        aId: a.id,
        bId: b.id,
        aName: a.name || '이름 없는 규칙',
        bName: b.name || '이름 없는 규칙',
        events,
        days,
        time: `${formatWindow(a.start, a.end)} ∩ ${formatWindow(b.start, b.end)}`,
      })
    }
  }
  return overlaps
}

/** EUC-KR 기준에 가깝게. 한글 2바이트, ASCII 1바이트. 90바이트까지 SMS, 그 이상은 LMS. */
export function smsByteLength(text: string) {
  let bytes = 0
  for (const char of text) {
    bytes += char.charCodeAt(0) <= 0x7f ? 1 : 2
  }
  return bytes
}

export function smsKind(text: string) {
  const bytes = smsByteLength(text)
  return { bytes, kind: bytes <= 90 ? 'SMS' : 'LMS' as const }
}
