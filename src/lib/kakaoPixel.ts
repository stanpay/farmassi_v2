/** 카카오 픽셀 헬퍼. `VITE_KAKAO_PIXEL_ID` 없으면 no-op. */

declare global {
  interface Window {
    kakaoPixel?: KakaoPixelFn
  }
}

type KakaoPixelInstance = {
  pageView: (tag?: string) => void
  /** 잠재고객(Participation). CTA 커스텀은 태그로 구분. */
  participation: (tag?: string) => void
  purchase: (payload?: KakaoPurchasePayload) => void
  login: (tag?: string) => void
}

type KakaoPixelFn = (trackId: string) => KakaoPixelInstance

export type KakaoPurchasePayload = {
  total_quantity?: string
  total_price?: string
  currency?: string
  products?: Array<{
    id?: string
    name?: string
    quantity?: number
    price?: number | string
  }>
  tag?: string
}

function trackId() {
  const id = import.meta.env.VITE_KAKAO_PIXEL_ID?.trim()
  return id || null
}

function pixel(): KakaoPixelInstance | null {
  const id = trackId()
  if (!id || typeof window.kakaoPixel !== 'function') return null
  try {
    return window.kakaoPixel(id)
  } catch {
    return null
  }
}

export function kakaoPixelPageView(tag?: string) {
  const p = pixel()
  if (!p) return
  if (tag) p.pageView(tag)
  else p.pageView()
}

/** CTA 등 커스텀 클릭 → Participation + tag. */
export function kakaoPixelTrack(name: string) {
  const p = pixel()
  if (!p || !name) return
  p.participation(name)
}

export function kakaoPixelPurchase(payload?: KakaoPurchasePayload) {
  const p = pixel()
  if (!p) return
  if (payload) p.purchase(payload)
  else p.purchase()
}

export function kakaoPixelLogin(tag?: string) {
  const p = pixel()
  if (!p) return
  if (tag) p.login(tag)
  else p.login()
}
