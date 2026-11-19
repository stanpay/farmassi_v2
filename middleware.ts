import { next } from '@vercel/functions'
import {
  farmSlugFromPath,
  isLinkPreviewBot,
  loadFarmOg,
  renderFarmOgHtml,
} from './og/farmPreview'

export const config = {
  matcher: ['/farm/:path*', '/o/:path*'],
}

/**
 * 카톡·문자 등 미리보기 봇에게만 농가별 OG HTML을 준다.
 * 일반 브라우저는 SPA(index.html)로 그대로 통과시킨다.
 */
export default async function middleware(request: Request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return next()
  }

  const ua = request.headers.get('user-agent')
  if (!isLinkPreviewBot(ua)) {
    return next()
  }

  const url = new URL(request.url)
  const slug = farmSlugFromPath(url.pathname)
  if (!slug) {
    return next()
  }

  try {
    const farm = await loadFarmOg(slug, url)
    if (!farm) {
      return next()
    }
    return new Response(renderFarmOgHtml(farm), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // UA 별로 응답이 다르므로 CDN에 공용 캐시하면 인앱 브라우저에 OG HTML이 굳을 수 있다.
        'Cache-Control': 'private, no-store',
        Vary: 'User-Agent',
      },
    })
  } catch {
    return next()
  }
}
