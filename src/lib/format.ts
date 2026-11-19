export function formatPrice(price: number): string {
  return `₩${price.toLocaleString('ko-KR')}`
}

export function formatWon(price: number): string {
  return `${price.toLocaleString('ko-KR')}원`
}

/** 계좌번호에서 하이픈·공백을 제거한다. 복사·QR 링크용. */
export function normalizeAccountNumber(value: string): string {
  return value.replace(/-/g, '').replace(/\s/g, '').trim()
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

export function productGradient(id: string): string {
  const list = [
    'from-orange-400 to-amber-500',
    'from-green-500 to-emerald-600',
    'from-red-400 to-rose-500',
    'from-purple-500 to-violet-600',
    'from-yellow-400 to-orange-500',
    'from-lime-400 to-green-600',
  ]
  let n = 0
  for (let i = 0; i < id.length; i += 1) n += id.charCodeAt(i)
  return list[n % list.length]
}

export function fullAddress(address: string, detail?: string | null, zonecode?: string | null): string {
  const zip = zonecode ? `[${zonecode}] ` : ''
  const extra = detail ? ` ${detail}` : ''
  return `${zip}${address}${extra}`.trim()
}

/** 농가 헤더·목록용: 실제 주소가 있으면 우선(우편번호 제외), 없으면 지역명 */
export function farmDisplayLocation(
  farm: {
    location?: string | null
    address?: string | null
    address_detail?: string | null
  },
  fallback = '',
): string {
  const address = fullAddress(farm.address ?? '', farm.address_detail)
  return address || farm.location?.trim() || fallback
}

export function kakaoChannelHref(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  if (/^(javascript|data|vbscript):/i.test(raw)) return null
  const href = /^https?:\/\//i.test(raw)
    ? raw
    : /^pf\.kakao\.com\//i.test(raw)
      ? `https://${raw}`
      : `https://pf.kakao.com/${raw.replace(/^\/+/, '')}`
  return href.replace(/\/+$/, '').replace(/\/chat$/i, '')
}

export function kakaoChannelChatHref(value: string | null | undefined): string | null {
  const profile = kakaoChannelHref(value)
  return profile ? `${profile}/chat` : null
}

export function safeHttpUrl(value: string | null | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  if (/^(javascript|data|vbscript):/i.test(raw)) return null
  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const parsed = new URL(href)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}
