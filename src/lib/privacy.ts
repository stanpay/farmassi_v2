import { digitsOnly } from './phone'

/** 고객 식별용 짧은 표시 해시. 검색·목록용 ID 로 쓴다(암호학 용도 아님). */
export function customerDisplayHash(seed: string): string {
  const input = seed.trim() || 'unknown'
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // 부호 없는 32비트 → 8자리 hex
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function maskPersonName(name: string): string {
  const value = name.trim()
  if (!value) return '—'
  if (value.length === 1) return '*'
  if (value.length === 2) return `${value[0]}*`
  return `${value[0]}${'*'.repeat(Math.min(value.length - 2, 4))}${value[value.length - 1]}`
}

export function maskPhone(phone: string): string {
  const digits = digitsOnly(phone)
  if (digits.length < 7) return '***-****-****'
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-****-${digits.slice(6)}`
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-****-${digits.slice(7)}`
  }
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`
}

export function maskAddress(address: string): string {
  const value = address.trim()
  if (!value) return '—'
  // 앞쪽 시·구 정도만 남기고 나머지는 가린다
  const parts = value.split(/\s+/).filter(Boolean)
  if (parts.length <= 2) return `${parts[0] ?? ''} ***`
  return `${parts.slice(0, 2).join(' ')} ***`
}
