import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { kakaoPixelPageView } from '../../lib/kakaoPixel'

/** SPA 라우트 변경 시 카카오 픽셀 pageView. */
export function KakaoPixel() {
  const location = useLocation()

  useEffect(() => {
    kakaoPixelPageView()
  }, [location.pathname, location.search])

  return null
}
