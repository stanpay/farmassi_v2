import { BRAND } from '../config/brand'
import { fullAddress } from './format'
import { formatPhone } from './phone'

export const FARM_SHARE_GREETING = '안녕하세요'
export const FARM_SHARE_ORDER_CTA = '👇 문의, 주문하러가기[클릭] 👇'

const LEGACY_ORDER_CTAS = [
  '👇 💬 카카오톡 문의와 주문하러가기[클릭] 👇',
  '👇 주문하러가기[클릭] 👇',
]

const LEAD_LINE_RE = /^\(광고\).*$/m
const NAME_LINE_RE = /^"[^"]*" 입니다\.$/m
const GRAPE_BLOCK_RE = /^🍇\s*.*(?:\n🍇\s*.*)*$/m
const LANDING_URL_RE = /https?:\/\/[^\s]+\/farm\/[^/\s]+\/landingpage/g
const PHONE_SECTION_RE = /(?:^|\n)문의전화\n(?:(?:☎️|📱)\s*.*(?:\n|$))*/
const LOCATION_LINE_RE = /^▶️\s*위치\s*:.*$/m
const MAP_LINE_RE = /^▶️\s*길안내\s*:.*$/m
const GREETING_LINE_RE = /^안녕하세요[^\n]*/m

export function farmLandingPath(slug: string) {
  return `/farm/${slug}/landingpage`
}

export function farmQrPath(slug: string) {
  return `/farm/${slug}/qr`
}

export function farmPublicOrigin() {
  return BRAND.siteUrl.replace(/\/+$/, '')
}

export function farmLandingUrl(slug: string, origin = farmPublicOrigin()) {
  return `${origin.replace(/\/+$/, '')}${farmLandingPath(slug)}`
}

export function farmQrUrl(slug: string, origin = farmPublicOrigin()) {
  return `${origin.replace(/\/+$/, '')}${farmQrPath(slug)}`
}

export function farmProductLines(summary: string | null | undefined) {
  if (!summary?.trim()) return []
  return summary
    .split(/[\n,·/|]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function farmShareLead(description: string | null | undefined) {
  const text = description?.trim()
  if (!text) return ''
  return /^\(광고\)/.test(text) ? text : `(광고) ${text}`
}

export interface FarmShareInput {
  name: string
  slug: string
  description?: string | null
  product_summary?: string | null
  phone?: string | null
  mobile_phone?: string | null
  address?: string | null
  address_zonecode?: string | null
  address_detail?: string | null
  map_url?: string | null
  share_text?: string | null
}

export function hasFarmShareDetails(farm: FarmShareInput) {
  return Boolean(
    farm.share_text?.trim() ||
      farm.description?.trim() ||
      farm.product_summary?.trim() ||
      farm.phone?.trim() ||
      farm.mobile_phone?.trim() ||
      farm.address?.trim() ||
      farm.address_detail?.trim() ||
      farm.map_url?.trim(),
  )
}

export function formatShareTextPhones(text: string) {
  return text.replace(/^(?:☎️|📱)\s*(.+)$/gm, (_match, raw: string) => {
    const formatted = formatPhone(raw)
    return `📱 ${formatted || raw.trim()}`
  })
}

function tidyBlankLines(text: string) {
  return text.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd()
}

function insertAfter(text: string, re: RegExp, line: string, blank = false) {
  if (!re.test(text)) return null
  const gap = blank ? '\n\n' : '\n'
  return text.replace(re, (match) => `${match}${gap}${line}`)
}

function upsertLine(text: string, re: RegExp, line: string, insert: () => string) {
  if (re.test(text)) {
    if (!line) return tidyBlankLines(text.replace(re, ''))
    return text.replace(re, () => line)
  }
  if (!line) return text
  return insert()
}

export function formatShareTextAddress(text: string, farm: FarmShareInput) {
  const address = fullAddress(farm.address ?? '', farm.address_detail, farm.address_zonecode)
  const locationLine = address ? `▶️ 위치 : ${address}` : ''
  return upsertLine(text, LOCATION_LINE_RE, locationLine, () =>
    MAP_LINE_RE.test(text) ? text.replace(MAP_LINE_RE, `${locationLine}\n$&`) : `${text.trimEnd()}\n\n${locationLine}`,
  )
}

export function formatShareTextOrderCta(text: string) {
  return LEGACY_ORDER_CTAS.reduce((next, legacy) => next.replaceAll(legacy, FARM_SHARE_ORDER_CTA), text)
}

export function formatFarmShareText(text: string, _farm?: FarmShareInput) {
  return formatShareTextOrderCta(formatShareTextPhones(text))
}

export function resolveFarmShareText(farm: FarmShareInput, origin?: string) {
  const text = farm.share_text?.trim() || buildFarmShareText(farm, origin)
  return formatFarmShareText(text, farm)
}

function farmNameLine(name: string) {
  const trimmed = name.trim()
  return trimmed ? `"${trimmed}" 입니다.` : ''
}

function productBlock(summary: string | null | undefined) {
  return farmProductLines(summary)
    .map((item) => `🍇 ${item}`)
    .join('\n')
}

function phoneSection(farm: FarmShareInput) {
  const phone = formatPhone(farm.phone)
  const mobile = formatPhone(farm.mobile_phone)
  if (!phone && !mobile) return ''
  return ['문의전화', phone ? `📱 ${phone}` : '', mobile ? `📱 ${mobile}` : ''].filter(Boolean).join('\n')
}

function patchShareTextLead(text: string, description: string | null | undefined) {
  const lead = farmShareLead(description)
  return upsertLine(text, LEAD_LINE_RE, lead, () => insertAfter(text, GREETING_LINE_RE, lead) ?? `${lead}\n${text}`)
}

function patchShareTextName(text: string, name: string) {
  const line = farmNameLine(name)
  return upsertLine(
    text,
    NAME_LINE_RE,
    line,
    () =>
      insertAfter(text, LEAD_LINE_RE, line, true) ??
      insertAfter(text, GREETING_LINE_RE, line, true) ??
      `${line}\n${text}`,
  )
}

function patchShareTextProducts(text: string, summary: string | null | undefined) {
  const block = productBlock(summary)
  return upsertLine(
    text,
    GRAPE_BLOCK_RE,
    block,
    () =>
      insertAfter(text, NAME_LINE_RE, block, true) ??
      insertAfter(text, LEAD_LINE_RE, block, true) ??
      insertAfter(text, GREETING_LINE_RE, block, true) ??
      `${text.trimEnd()}\n\n${block}`,
  )
}

function patchShareTextLandingUrl(text: string, slug: string, origin?: string) {
  const url = slug.trim() ? farmLandingUrl(slug.trim(), origin) : ''
  if (LANDING_URL_RE.test(text)) {
    LANDING_URL_RE.lastIndex = 0
    if (!url) return tidyBlankLines(text.replace(LANDING_URL_RE, ''))
    return text.replace(LANDING_URL_RE, url)
  }
  if (!url) return text
  if (text.includes(FARM_SHARE_ORDER_CTA)) {
    return text.replace(FARM_SHARE_ORDER_CTA, `${FARM_SHARE_ORDER_CTA}\n${url}`)
  }
  return `${text.trimEnd()}\n\n${FARM_SHARE_ORDER_CTA}\n${url}`
}

function patchShareTextPhoneSection(text: string, farm: FarmShareInput) {
  const section = phoneSection(farm)
  if (PHONE_SECTION_RE.test(text)) {
    if (!section) return tidyBlankLines(text.replace(PHONE_SECTION_RE, '\n'))
    return text.replace(PHONE_SECTION_RE, (match) => `${match.startsWith('\n') ? '\n' : ''}${section}\n`)
  }
  if (!section) return text
  if (LOCATION_LINE_RE.test(text)) return text.replace(LOCATION_LINE_RE, `${section}\n\n$&`)
  if (MAP_LINE_RE.test(text)) return text.replace(MAP_LINE_RE, `${section}\n\n$&`)
  return `${text.trimEnd()}\n\n${section}`
}

function patchShareTextMap(text: string, mapUrl: string | null | undefined) {
  const map = mapUrl?.trim() ?? ''
  const line = map ? `▶️ 길안내 : ${map}` : ''
  return upsertLine(text, MAP_LINE_RE, line, () => insertAfter(text, LOCATION_LINE_RE, line) ?? `${text.trimEnd()}\n\n${line}`)
}

function shareSourceEqual(a: FarmShareInput, b: FarmShareInput) {
  return (
    a.name === b.name &&
    a.slug === b.slug &&
    (a.description ?? '') === (b.description ?? '') &&
    (a.product_summary ?? '') === (b.product_summary ?? '') &&
    (a.phone ?? '') === (b.phone ?? '') &&
    (a.mobile_phone ?? '') === (b.mobile_phone ?? '') &&
    (a.address ?? '') === (b.address ?? '') &&
    (a.address_zonecode ?? '') === (b.address_zonecode ?? '') &&
    (a.address_detail ?? '') === (b.address_detail ?? '') &&
    (a.map_url ?? '') === (b.map_url ?? '')
  )
}

export function patchFarmShareText(text: string, prev: FarmShareInput, next: FarmShareInput, origin?: string) {
  if (!text.trim() || shareSourceEqual(prev, next)) return text

  let result = text
  if ((prev.description ?? '') !== (next.description ?? '')) {
    result = patchShareTextLead(result, next.description)
  }
  if (prev.name !== next.name) {
    result = patchShareTextName(result, next.name)
  }
  if ((prev.product_summary ?? '') !== (next.product_summary ?? '')) {
    result = patchShareTextProducts(result, next.product_summary)
  }
  if (prev.slug !== next.slug) {
    result = patchShareTextLandingUrl(result, next.slug, origin)
  }
  if ((prev.phone ?? '') !== (next.phone ?? '') || (prev.mobile_phone ?? '') !== (next.mobile_phone ?? '')) {
    result = patchShareTextPhoneSection(result, next)
  }
  if (
    (prev.address ?? '') !== (next.address ?? '') ||
    (prev.address_detail ?? '') !== (next.address_detail ?? '') ||
    (prev.address_zonecode ?? '') !== (next.address_zonecode ?? '')
  ) {
    result = formatShareTextAddress(result, next)
  }
  if ((prev.map_url ?? '') !== (next.map_url ?? '')) {
    result = patchShareTextMap(result, next.map_url)
  }
  return result
}

export function buildFarmShareText(farm: FarmShareInput, origin?: string) {
  const lines: string[] = [FARM_SHARE_GREETING]
  const lead = farmShareLead(farm.description)
  if (lead) lines.push(lead)

  const name = farm.name.trim()
  if (name) {
    if (lead) lines.push('')
    lines.push(`"${name}" 입니다.`)
  }

  const products = farmProductLines(farm.product_summary)
  if (products.length) {
    lines.push('')
    for (const item of products) lines.push(`🍇 ${item}`)
  }

  const slug = farm.slug.trim()
  if (slug) {
    lines.push('')
    lines.push(FARM_SHARE_ORDER_CTA)
    lines.push(farmLandingUrl(slug, origin))
  }

  const phone = formatPhone(farm.phone)
  const mobile = formatPhone(farm.mobile_phone)
  if (phone || mobile) {
    lines.push('')
    lines.push('문의전화')
    if (phone) lines.push(`📱 ${phone}`)
    if (mobile) lines.push(`📱 ${mobile}`)
  }

  const address = fullAddress(farm.address ?? '', farm.address_detail, farm.address_zonecode)
  const map = farm.map_url?.trim()
  if (address || map) {
    lines.push('')
    if (address) lines.push(`▶️ 위치 : ${address}`)
    if (map) lines.push(`▶️ 길안내 : ${map}`)
  }

  return lines.join('\n').trim()
}

export function telHref(phone: string | null | undefined) {
  const digits = phone?.replace(/[^\d+]/g, '') ?? ''
  return digits ? `tel:${digits}` : null
}
