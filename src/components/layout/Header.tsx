import { useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import { copyText } from '../../lib/clipboard'
import { useNavContext } from './NavContext'

interface HeaderProps {
  title: string
  subtitle?: string
  /** 부제 옆에 초록색 '주소복사' 표시. 클릭 시 subtitle 복사 */
  copyableSubtitle?: boolean
  showBack?: boolean
  backTo?: string
  rightElement?: ReactNode
}

export function Header({
  title,
  subtitle,
  copyableSubtitle,
  showBack,
  backTo,
  rightElement,
}: HeaderProps) {
  const navigate = useNavigate()
  const { mobileSettingsItem } = useNavContext()
  const [copied, setCopied] = useState(false)

  const handleBack = () => {
    if (backTo) navigate(backTo, { replace: true })
    else navigate(-1)
  }

  async function handleCopySubtitle() {
    if (!subtitle) return
    const ok = await copyText(subtitle)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-gray-100 px-4 py-3 md:px-6">
      <div className="flex items-center gap-3 max-w-5xl mx-auto">
        {showBack && (
          <button
            data-leave-guard
            type="button"
            onClick={handleBack}
            className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100 transition-colors shrink-0"
            aria-label="뒤로가기"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-900 truncate">{title}</h1>
          {subtitle && (
            <p className="flex items-center gap-1.5 text-xs text-muted min-w-0">
              <span className="truncate">{subtitle}</span>
              {copyableSubtitle && (
                <button
                  type="button"
                  onClick={() => void handleCopySubtitle()}
                  className="shrink-0 font-medium text-primary hover:underline"
                >
                  {copied ? '복사됨' : '주소복사'}
                </button>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {rightElement}
          {mobileSettingsItem && (
            <NavLink
              to={mobileSettingsItem.to}
              className={({ isActive }) =>
                `md:hidden flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${
                  isActive ? 'bg-primary-light text-primary' : 'text-gray-500 hover:bg-gray-100'
                }`
              }
              aria-label={mobileSettingsItem.label}
            >
              {({ isActive }) => {
                const Icon = mobileSettingsItem.icon
                return <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
              }}
            </NavLink>
          )}
        </div>
      </div>
    </header>
  )
}
