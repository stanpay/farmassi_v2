import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ErrorText } from '../ui/Feedback'
import { useAuth } from '../../lib/auth'
import { kakaoPixelLogin, kakaoPixelTrack } from '../../lib/kakaoPixel'
import { KakaoLoginButton } from './KakaoLoginButton'

interface OpenLoginOptions {
  next?: string
  dismissTo?: string
}

interface LoginSheetState {
  open: boolean
  openLogin: (options?: OpenLoginOptions) => void
  closeLogin: () => void
}

const LoginSheetContext = createContext<LoginSheetState | null>(null)

function safeNext(raw?: string | null) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

export function dismissPath(pathname: string) {
  const checkout = pathname.match(/^\/(?:o|farm)\/([^/]+)\/checkout/)
  if (checkout) return `/farm/${checkout[1]}`
  return '/'
}

export function LoginSheetProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { user, signInWithKakao } = useAuth()
  const [open, setOpen] = useState(false)
  const [next, setNext] = useState('/')
  const [dismissTo, setDismissTo] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const closeLogin = useCallback(() => {
    const target = dismissTo
    setOpen(false)
    setError('')
    setPending(false)
    setDismissTo(null)
    if (target) navigate(target, { replace: true })
  }, [dismissTo, navigate])

  const openLogin = useCallback((options?: OpenLoginOptions) => {
    setNext(safeNext(options?.next))
    setDismissTo(options?.dismissTo ?? null)
    setError('')
    setPending(false)
    setOpen(true)
  }, [])

  useEffect(() => {
    if (user && open) {
      setOpen(false)
      setDismissTo(null)
    }
  }, [user, open])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLogin()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, closeLogin])

  const value = useMemo<LoginSheetState>(
    () => ({ open, openLogin, closeLogin }),
    [open, openLogin, closeLogin],
  )

  return (
    <LoginSheetContext.Provider value={value}>
      {children}
      {open
        ? createPortal(
            <div className="fixed inset-0 z-[60] flex items-end justify-center">
              <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="닫기"
                onClick={closeLogin}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="로그인"
                className="animate-sheet-up relative w-full max-w-md rounded-t-3xl bg-white px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,0.12)]"
              >
                <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-gray-200" />
                <div className="space-y-3">
                  <ErrorText>{error}</ErrorText>
                  <KakaoLoginButton
                    disabled={pending}
                    onClick={() => {
                      kakaoPixelTrack('cta_kakao_login')
                      kakaoPixelLogin('cta_kakao_login')
                      setError('')
                      setPending(true)
                      void signInWithKakao(next).catch((err) => {
                        setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
                        setPending(false)
                      })
                    }}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </LoginSheetContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLoginSheet() {
  const ctx = useContext(LoginSheetContext)
  if (!ctx) throw new Error('useLoginSheet는 LoginSheetProvider 안에서만 사용할 수 있습니다.')
  return ctx
}
