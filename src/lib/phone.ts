export const CUSTOM_PHONE_PREFIX = 'custom'

export const PHONE_PREFIXES = ['010', '011', '016', '017', '018', '019'] as const

export function digitsOnly(value: string) {
  return value.replace(/\D/g, '')
}

/**
 * 카톡에 흔한 표기를 숫자만인 휴대전화로 정규화한다.
 * - `-` `~` 공백 등 구분자는 모두 제거
 * - 8자리(국번+번호)만 있으면 `010` 보정
 * - `10xxxxxxxx`(앞 0 누락)이면 `0` 보정
 */
export function normalizePhoneDigits(value: string): string {
  let digits = digitsOnly(value)
  if (!digits) return ''

  if (digits.length === 8) digits = `010${digits}`
  else if (digits.length === 7) digits = `010${digits}`
  else if (digits.length === 10 && digits.startsWith('10')) digits = `0${digits}`

  return digits
}

/** 저장·tel·고객 매칭용. 가능하면 `010-1234-5678` 형태. 불가하면 빈 문자열. */
export function normalizePhone(value: string | null | undefined): string {
  const raw = value?.trim() ?? ''
  if (!raw) return ''
  const digits = normalizePhoneDigits(raw)
  if (digits.length < 10 || digits.length > 11) return ''
  const parsed = parsePhone(digits)
  if (parsed.mid.length < 3 || parsed.last.length !== 4) return ''
  return composePhone(parsed.prefix, parsed.mid, parsed.last)
}

export function isNormalizedPhone(value: string | null | undefined): boolean {
  return Boolean(normalizePhone(value))
}

export interface ParsedPhone {
  prefix: string
  mid: string
  last: string
  isListed: boolean
}

function splitRest(rest: string) {
  const digits = rest.slice(0, 8)
  if (digits.length <= 4) return { mid: digits, last: '' }
  if (digits.length <= 7) return { mid: digits.slice(0, digits.length - 4), last: digits.slice(-4) }
  return { mid: digits.slice(0, 4), last: digits.slice(4, 8) }
}

export function parsePhone(value: string): ParsedPhone {
  const parts = value.split('-').map(digitsOnly).filter(Boolean)
  if (parts.length >= 3) {
    const prefix = parts[0]
    return {
      prefix,
      mid: parts[1].slice(0, 4),
      last: parts[2].slice(0, 4),
      isListed: PHONE_PREFIXES.includes(prefix as (typeof PHONE_PREFIXES)[number]),
    }
  }
  if (parts.length === 2) {
    const prefix = parts[0]
    const rest = parts[1]
    return {
      prefix,
      ...(rest.length > 4 ? splitRest(rest) : { mid: rest.slice(0, 4), last: '' }),
      isListed: PHONE_PREFIXES.includes(prefix as (typeof PHONE_PREFIXES)[number]),
    }
  }

  const digits = digitsOnly(value)
  if (!digits) return { prefix: '010', mid: '', last: '', isListed: true }

  const listed = PHONE_PREFIXES.find((item) => digits.startsWith(item))
  if (listed) {
    return { prefix: listed, ...splitRest(digits.slice(listed.length)), isListed: true }
  }

  const prefixLen = digits.startsWith('0') ? 3 : 4
  return { prefix: digits.slice(0, prefixLen), ...splitRest(digits.slice(prefixLen)), isListed: false }
}

export function composePhone(prefix: string, mid: string, last: string) {
  const head = digitsOnly(prefix)
  const middle = digitsOnly(mid).slice(0, 4)
  const tail = digitsOnly(last).slice(0, 4)
  if (!middle && !tail) return ''
  return [head, middle, tail].filter(Boolean).join('-')
}

export function formatPhone(value: string | null | undefined) {
  const raw = value?.trim() ?? ''
  if (!raw) return ''
  const normalized = normalizePhone(raw)
  if (normalized) return normalized
  const parsed = parsePhone(normalizePhoneDigits(raw) || raw)
  return composePhone(parsed.prefix, parsed.mid, parsed.last) || raw
}
