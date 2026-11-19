import { next } from '@vercel/functions'
import {
  farmSlugFromPath,
  injectFarmOgIntoHtml,
  isLinkPreviewBot,
  loadFarmOg,
} from './og/farmPreview'

export const config = {
  matcher: ['/farm/:path*', '/o/:path*'],
}

/**
 * 농가 공개 URL은 모든 UA에 농가 OG 메타가 들어간 SPA HTML을 준다.
 *
 * 문자 미리보기(iMessage 등)는 일반 Safari처럼 보이기도 해서, 봇만 골라
 * 응답하면 index.html 의 공통 기본 OG만 붙는다.
 */
export default async function middleware(request: Request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return next()
  }

  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const ua = request.headers.get('user-agent')

  // 카톡 등은 /farm/slug 와 /landingpage 를 URL별로 따로 캐시한다.
  // 스토어 URL을 스크랩하면 랜딩으로 보내 미리보기 캐시를 한곳으로 모은다.
  const storeOnly = pathname.match(/^\/farm\/([^/]+)$/)
  if (storeOnly && isLinkPreviewBot(ua)) {
    const dest = new URL(`/farm/${storeOnly[1]}/landingpage${url.search}`, url.origin)
    return Response.redirect(dest.toString(), 302)
  }

  const slug = farmSlugFromPath(url.pathname)
  if (!slug) {
    return next()
  }

  try {
    const farm = await loadFarmOg(slug, url)
    if (!farm) {
      return next()
    }

    // /index.html 은 matcher 밖이라 미들웨어 재진입 없이 정적 SPA 셸을 가져온다.
    const indexRes = await fetch(new URL('/index.html', url.origin), {
      headers: { Accept: 'text/html' },
    })
    if (!indexRes.ok) {
      return next()
    }

    const html = injectFarmOgIntoHtml(await indexRes.text(), farm)
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return next()
  }
}
