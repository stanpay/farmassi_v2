import { next } from '@vercel/functions'
import {
  farmSlugFromPath,
  injectFarmOgIntoHtml,
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
 *
 * /farm/slug 를 랜딩으로 302 하면 카톡이 상대 Location 만 보고 OG 를
 * 못 읽는 경우가 있어, 스토어·랜딩 모두 여기서 바로 메타를 심는다.
 */
export default async function middleware(request: Request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return next()
  }

  const url = new URL(request.url)
  // 카톡은 /farm/slug 와 /farm/slug/ 를 다른 URL로 캐시한다.
  // 끝 슬래시는 절대 URL로 308 해서 미리보기 키를 하나로 맞춘다.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    const canonical = new URL(url.pathname.replace(/\/+$/, '') + url.search, url.origin)
    return Response.redirect(canonical.toString(), 308)
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
