/**
 * 카톡·문자 등 링크 미리보기(OG)용 농가 메타.
 * Vercel Routing Middleware에서만 사용한다. 브라우저 번들에 넣지 않는다.
 */

export type FarmOgData = {
  name: string
  description: string
  imageUrl: string
  pageUrl: string
}

const BOT_UA =
  /kakaotalk|kakaobot|slackbot|twitterbot|facebookexternalhit|facebot|linkedinbot|discordbot|whatsapp|telegrambot|applebot|googlebot|bingbot|yandex|baiduspider|embedly|quora link preview|showyoubot|outbrain|pinterest|redditbot|vkshare|w3c_validator|iframely|meta-externalagent|scrapy|curl|wget|preview/i

export function isLinkPreviewBot(userAgent: string | null): boolean {
  if (!userAgent) return false
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
  if (fromEnv && !/^https?:\/\/localhost\b/i.test(fromEnv) && !/^https?:\/\/127\./.test(fromEnv)) {
    return fromEnv
  }
  // apex → www 리다이렉트 환경에서도 OG 절대 URL이 안정적으로 www 를 가리키게 한다.
  if (requestUrl.hostname === 'farmassi.kr') {
    return 'https://www.farmassi.kr'
  }
  return requestUrl.origin
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
  if (!trimmed) return `${site}/og-default.jpg`
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

  // 공유 URL은 안내 문자와 같이 랜딩을 canonical 로 둔다.
  const pageUrl = `${site}/farm/${encodeURIComponent(slug)}/landingpage`

  return {
    name: farm.name,
    description,
    imageUrl: absoluteUrl(image ?? '/og-default.jpg', site),
    pageUrl,
  }
}

export function renderFarmOgHtml(data: FarmOgData): string {
  const title = escapeHtml(data.name)
  const description = escapeHtml(data.description)
  const image = escapeHtml(data.imageUrl)
  const url = escapeHtml(data.pageUrl)

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${title} | 팜어시</title>
  <meta name="description" content="${description}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="팜어시" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:locale" content="ko_KR" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />
</head>
<body>
  <p>${title}</p>
  <p>${description}</p>
  <p><a href="${url}">페이지 열기</a></p>
</body>
</html>`
}

export function renderSiteOgHtml(site: string): string {
  const title = '팜어시 | Farmassi'
  const description = '팜어시(Farmassi) - 농가 직송 주문·배송 플랫폼'
  const image = escapeHtml(`${site.replace(/\/+$/, '')}/og-default.jpg`)
  const url = escapeHtml(site.replace(/\/+$/, '') + '/')
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="팜어시" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />
</head>
<body>
  <p><a href="${url}">팜어시</a></p>
</body>
</html>`
}
