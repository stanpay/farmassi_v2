/**
 * 카톡·문자 등 링크 미리보기(OG)용 농가 메타.
 * Vercel Routing Middleware에서만 사용한다. 브라우저 번들에 넣지 않는다.
 */

export type FarmOgData = {
  name: string
  description: string
  imageUrl: string
  /** og:url / canonical (보통 랜딩 URL) */
  pageUrl: string
  /** 사람이 OG HTML을 열었을 때 보낼 실제 앱 URL */
  appUrl: string
}

/**
 * 링크 미리보기 크롤러만 잡는다.
 *
 * 주의: 카톡 인앱 브라우저 UA에도 `KAKAOTALK/... (INAPP)` 이 들어 있다.
 * 여기에 `/kakaotalk/` 를 쓰면 사용자가 링크를 열 때 OG용 빈 HTML만 보게 된다.
 * 카카오 공식 스크랩 UA: `facebookexternalhit/1.1; kakaotalk-scrap/1.0; ...`
 */
const BOT_UA =
  /kakaotalk-scrap|kakaostory-og-reader|slackbot|twitterbot|facebookexternalhit|facebot|linkedinbot|discordbot|whatsapp|telegrambot|applebot|googlebot|bingbot|yandex|baiduspider|embedly|quora link preview|showyoubot|outbrain|pinterest|redditbot|vkshare|w3c_validator|iframely|meta-externalagent|scrapy/i

export function isLinkPreviewBot(userAgent: string | null): boolean {
  if (!userAgent) return false
  // 카톡·기타 인앱 웹뷰는 실제 사용자 → SPA
  if (/\(INAPP\)/i.test(userAgent)) return false
  if (/KAKAOTALK\//i.test(userAgent) && /Mozilla\//i.test(userAgent)) return false
  return BOT_UA.test(userAgent)
}

/** /farm/:slug, /farm/:slug/landingpage|qr|checkout, /o/:slug */
export function farmSlugFromPath(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, '') || '/'
  const farm = clean.match(/^\/farm\/([^/]+)(?:\/(landingpage|qr|checkout))?$/)
  if (farm?.[1]) return decodeURIComponent(farm[1])
  const legacy = clean.match(/^\/o\/([^/]+)$/)
  if (legacy?.[1]) return decodeURIComponent(legacy[1])
  return null
}

function apiBase(): string {
  const raw = process.env.API_URL || process.env.VITE_API_URL || 'https://api.shop.lkim.me'
  return raw.replace(/\/+$/, '')
}

function siteBase(requestUrl: URL): string {
  const fromEnv = (process.env.SITE_URL || process.env.VITE_SITE_URL || '').replace(/\/+$/, '')
  let base = fromEnv
  if (!base || /^https?:\/\/localhost\b/i.test(base) || /^https?:\/\/127\./.test(base)) {
    base = requestUrl.origin
  }
  // apex 는 www 로 308 되므로 OG 절대 URL은 항상 www 를 쓴다.
  try {
    const u = new URL(base)
    if (u.hostname === 'farmassi.kr') {
      u.hostname = 'www.farmassi.kr'
      return u.origin
    }
  } catch {
    /* ignore */
  }
  return base.replace(/\/+$/, '')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function absoluteUrl(maybeRelative: string, site: string): string {
  const trimmed = maybeRelative.trim()
  if (!trimmed) return `${site}/pwa-512.png`
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (trimmed.startsWith('/')) return `${site}${trimmed}`
  return `${site}/${trimmed}`
}

function firstLandingImage(landingBlocks: unknown): string | null {
  if (!Array.isArray(landingBlocks)) return null
  for (const item of landingBlocks) {
    if (!item || typeof item !== 'object') continue
    const url = (item as { image_url?: unknown }).image_url
    if (typeof url === 'string' && url.trim()) return url.trim()
  }
  return null
}

async function queryApi<T>(body: Record<string, unknown>): Promise<T | null> {
  const response = await fetch(`${apiBase()}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) return null
  const payload = (await response.json().catch(() => null)) as { data?: T } | null
  return payload?.data ?? null
}

export async function loadFarmOg(slug: string, requestUrl: URL): Promise<FarmOgData | null> {
  const site = siteBase(requestUrl)
  const farm = await queryApi<{
    id: string
    name: string
    description: string | null
    product_summary: string | null
    landing_blocks: unknown
  }>({
    table: 'farms',
    op: 'select',
    select: 'id,name,description,product_summary,landing_blocks',
    filters: [{ column: 'slug', op: 'eq', value: slug }],
    single: 'maybe',
  })

  if (!farm) return null

  let image = firstLandingImage(farm.landing_blocks)

  if (!image) {
    const products = await queryApi<Array<{ image_url: string | null }>>({
      table: 'products',
      op: 'select',
      select: 'image_url',
      filters: [
        { column: 'farm_id', op: 'eq', value: farm.id },
        { column: 'is_active', op: 'eq', value: true },
      ],
      order: [{ column: 'sort_order', ascending: true }],
      limit: 20,
    })
    const hit = (products ?? []).find((p) => typeof p.image_url === 'string' && p.image_url.trim())
    if (hit?.image_url) image = hit.image_url.trim()
  }

  const description =
    (farm.description && farm.description.trim()) ||
    (farm.product_summary && farm.product_summary.trim()) ||
    '농가에서 바로, 신선한 직송'

  // og:url 은 스크랩 중인 주소와 같아야 한다.
  // /farm/slug 를 긁었는데 og:url 만 /landingpage 로 바꾸면 카톡이 URL별 캐시를 헷갈린다.
  const path = requestUrl.pathname.replace(/\/+$/, '') || `/farm/${encodeURIComponent(slug)}`
  const pageUrl = `${site}${path}${requestUrl.search}`

  return {
    name: farm.name,
    description,
    imageUrl: absoluteUrl(image ?? '/pwa-512.png', site),
    pageUrl,
    appUrl: pageUrl,
  }
}

function replaceMetaByProperty(html: string, property: string, content: string): string {
  const re = new RegExp(
    `<meta\\s+[^>]*property=["']${property}["'][^>]*>`,
    'i',
  )
  const tag = `<meta property="${property}" content="${escapeHtml(content)}" />`
  if (re.test(html)) return html.replace(re, tag)
  return html.replace(/<\/head>/i, `    ${tag}\n  </head>`)
}

function replaceMetaByName(html: string, name: string, content: string): string {
  const re = new RegExp(`<meta\\s+[^>]*name=["']${name}["'][^>]*>`, 'i')
  const tag = `<meta name="${name}" content="${escapeHtml(content)}" />`
  if (re.test(html)) return html.replace(re, tag)
  return html.replace(/<\/head>/i, `    ${tag}\n  </head>`)
}

/**
 * SPA index.html 에 농가 OG 를 심는다.
 * 문자(iMessage 등)는 UA가 들쭉날쭉해서 봇 판별만으로는 농가 사진이 안 나가고,
 * 공통 기본 OG만 잡히는 경우가 있다. Apple도 UA 무관하게 같은 메타를 주라고 권장한다.
 */
export function injectFarmOgIntoHtml(indexHtml: string, data: FarmOgData): string {
  const title = `${data.name} | 팜어시`
  const imageType = data.imageUrl.toLowerCase().includes('.png')
    ? 'image/png'
    : data.imageUrl.toLowerCase().includes('.webp')
      ? 'image/webp'
      : data.imageUrl.toLowerCase().includes('.gif')
        ? 'image/gif'
        : 'image/jpeg'
  let html = indexHtml
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`)
  html = replaceMetaByName(html, 'description', data.description)
  html = replaceMetaByName(html, 'twitter:card', 'summary_large_image')
  html = replaceMetaByName(html, 'twitter:title', data.name)
  html = replaceMetaByName(html, 'twitter:description', data.description)
  html = replaceMetaByName(html, 'twitter:image', data.imageUrl)
  html = replaceMetaByProperty(html, 'og:type', 'website')
  html = replaceMetaByProperty(html, 'og:site_name', '팜어시')
  html = replaceMetaByProperty(html, 'og:title', data.name)
  html = replaceMetaByProperty(html, 'og:description', data.description)
  html = replaceMetaByProperty(html, 'og:url', data.pageUrl)
  html = replaceMetaByProperty(html, 'og:image', data.imageUrl)
  html = replaceMetaByProperty(html, 'og:image:secure_url', data.imageUrl)
  html = replaceMetaByProperty(html, 'og:image:type', imageType)
  // 실제 농가 사진 비율과 다른 1200x630 를 적으면 카톡이 이미지를 버릴 수 있어 제거한다.
  html = html.replace(/<meta\s+[^>]*property=["']og:image:width["'][^>]*>\s*/gi, '')
  html = html.replace(/<meta\s+[^>]*property=["']og:image:height["'][^>]*>\s*/gi, '')
  html = replaceMetaByProperty(html, 'og:locale', 'ko_KR')
  if (!/rel=["']canonical["']/i.test(html)) {
    html = html.replace(/<\/head>/i, `    <link rel="canonical" href="${escapeHtml(data.pageUrl)}" />\n  </head>`)
  } else {
    html = html.replace(
      /<link\s+[^>]*rel=["']canonical["'][^>]*>/i,
      `<link rel="canonical" href="${escapeHtml(data.pageUrl)}" />`,
    )
  }
  return html
}
