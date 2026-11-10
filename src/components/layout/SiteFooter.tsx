import { useEffect, useState } from 'react'
import { BRAND } from '../../config/brand'

/**
 * 페이지 맨 아래 사업자 정보.
 * 문서 최하단에 도달했을 때만 표시한다. (본문은 min-h-dvh로 한 화면을 채우고
 * 푸터는 그 밖에 두어, 스크롤해야만 끝에 닿는다.)
 */
export function SiteFooter({ className = '' }: { className?: string }) {
  const [atBottom, setAtBottom] = useState(false)

  useEffect(() => {
    const update = () => {
      const scrollHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      )
      const scrollBottom = window.scrollY + window.innerHeight
      // 모바일 주소창/서브픽셀 오차 여유
      setAtBottom(scrollBottom >= scrollHeight - 8)
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const ro = new ResizeObserver(update)
    ro.observe(document.body)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      ro.disconnect()
    }
  }, [])

  return (
    <footer
      className={`border-t border-gray-200/80 bg-white/80 transition-all duration-300 ease-out ${
        atBottom ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
      } ${className}`}
      aria-hidden={!atBottom}
    >
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        <dl className="space-y-1.5 text-xs leading-5 text-muted">
          <div className="flex flex-wrap gap-x-2">
            <dt className="sr-only">회사명</dt>
            <dd className="font-medium text-gray-700">{BRAND.companyName}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt>대표자</dt>
            <dd className="text-gray-700">{BRAND.ceoName}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="shrink-0">주소</dt>
            <dd className="text-gray-700">{BRAND.companyAddress}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt>사업자등록번호</dt>
            <dd className="text-gray-700">{BRAND.businessNumber}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt>이메일</dt>
            <dd>
              <a
                href={`mailto:${BRAND.contactEmail}`}
                className="text-gray-700 underline-offset-2 hover:underline"
                tabIndex={atBottom ? 0 : -1}
              >
                {BRAND.contactEmail}
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </footer>
  )
}
