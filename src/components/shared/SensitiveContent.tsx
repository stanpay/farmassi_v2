import { Eye, EyeOff } from 'lucide-react'
import { useState, type ReactNode } from 'react'

/**
 * 민감 정보는 기본으로 가리고, 누르면 보이게 한다.
 * 마스킹 힌트는 보여 주지 않는다.
 */
export function SensitiveContent({
  label = '민감한 정보',
  children,
  className = '',
}: {
  label?: string
  children: ReactNode
  className?: string
  /** @deprecated 힌트는 노출하지 않음 */
  preview?: ReactNode
}) {
  const [revealed, setRevealed] = useState(false)

  if (revealed) {
    return (
      <span className={`inline-flex max-w-full items-center gap-1.5 ${className}`}>
        <span className="min-w-0 break-words text-sm">{children}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setRevealed(false)
          }}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-gray-100 hover:text-gray-700"
          aria-label="다시 가리기"
        >
          <EyeOff className="h-3 w-3" />
          가리기
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setRevealed(true)
      }}
      className={`inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 transition hover:border-primary/40 hover:bg-primary-light/50 hover:text-primary ${className}`}
      aria-label={`${label} 보기`}
      title="눌러서 보기"
    >
      <Eye className="h-3.5 w-3.5 shrink-0" />
      {label} 보기
    </button>
  )
}
