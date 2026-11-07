import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

/** 안드로이드 앱 카카오 로그인 콜백. AndroidManifest 의 scheme 과 같아야 한다. */
export const APP_AUTH_CALLBACK = 'kr.farmassi.app://auth/callback'

/**
 * 앱 로그인도 일단 HTTPS 콜백(+native=1)을 쓴다.
 * 운영 API 가 커스텀 스킴을 아직 막아 웹으로 바꿔 버리기 때문이다.
 * AuthCallback 이 native=1 이면 곧바로 kr.farmassi.app:// 로 앱을 연다.
 * (PWA/크롬이 잠깐 뜰 수 있지만, 배포된 웹이면 앱으로 넘긴다.)
 */
export function kakaoRedirectTo() {
  const web = `${window.location.origin}/auth/callback`
  if (Capacitor.isNativePlatform()) return `${web}?native=1`
  return web
}

export function shouldHandoffToNativeApp() {
  if (Capacitor.isNativePlatform()) return false
  return new URLSearchParams(window.location.search).get('native') === '1'
}

export function nativeAppCallbackUrl() {
  return `${APP_AUTH_CALLBACK}${window.location.search}`
}

/** Chrome/PWA 에서도 설치한 Capacitor 앱(패키지)을 강제한다. */
export function nativeAppIntentUrl() {
  const search = window.location.search
  return `intent://auth/callback${search}#Intent;scheme=kr.farmassi.app;package=kr.farmassi.app;end`
}

function webOrigin() {
  if (window.location.protocol === 'https:' || window.location.protocol === 'http:') {
    return window.location.origin
  }
  return 'https://farmassi.kr'
}

function toWebCallback(url: string) {
  if (url.startsWith(APP_AUTH_CALLBACK)) {
    const searchIndex = url.indexOf('?')
    const search = searchIndex >= 0 ? url.slice(searchIndex) : ''
    return `${webOrigin()}/auth/callback${search}`
  }
  try {
    const parsed = new URL(url)
    if (
      (parsed.hostname === 'farmassi.kr' || parsed.hostname.endsWith('.farmassi.kr'))
      && parsed.pathname.startsWith('/auth/callback')
    ) {
      return url
    }
  } catch {
    return null
  }
  return null
}

function openWebCallback(url: string) {
  const next = toWebCallback(url)
  if (!next || window.location.href === next) return
  window.location.replace(next)
}

/** 카카오톡이 브라우저 대신 앱으로 콜백을 열면 /auth/callback 으로 넘긴다. */
export function listenNativeAuthRedirect() {
  if (!Capacitor.isNativePlatform()) return
  void App.getLaunchUrl().then((result) => {
    if (result?.url) openWebCallback(result.url)
  })
  void App.addListener('appUrlOpen', ({ url }) => {
    openWebCallback(url)
  })
}
