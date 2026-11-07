import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ErrorText, PageSpinner } from '../../components/ui/Feedback'
import {
  nativeAppCallbackUrl,
  nativeAppIntentUrl,
  shouldHandoffToNativeApp,
} from '../../lib/nativeAuthRedirect'
import { markProfilePending } from '../../lib/profileCompletion'
import { supabase } from '../../lib/supabase'

function safeNext(raw: string | null) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

export function AuthCallback() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState('')
  const handoff = shouldHandoffToNativeApp()

  useEffect(() => {
    if (shouldHandoffToNativeApp()) {
      // intent 가 PWA/크롬보다 Capacitor 앱을 우선한다.
      window.location.replace(nativeAppIntentUrl())
      return
    }

    const next = safeNext(params.get('next') || sessionStorage.getItem('farmassi-next'))
    let done = false

    function go(path: string) {
      if (done) return
      done = true
      sessionStorage.removeItem('farmassi-next')
      navigate(path, { replace: true })
    }

    async function finish() {
      const oauthError = params.get('error_description') || params.get('error')
      if (oauthError) {
        setError(oauthError)
        return
      }

      const code = params.get('code')
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          const { data } = await supabase.auth.getSession()
          if (data.session) {
            if (params.get('profile') === '1') markProfilePending()
            go(next)
            return
          }
          setError(exchangeError.message)
          return
        }
        if (params.get('profile') === '1') markProfilePending()
        go(next)
        return
      }

      const { data } = await supabase.auth.getSession()
      if (data.session) {
        go(next)
        return
      }
      go('/')
    }

    void finish()
  }, [navigate, params])

  if (handoff) {
    const intentUrl = nativeAppIntentUrl()
    const appUrl = nativeAppCallbackUrl()
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 px-4">
        <PageSpinner label="팜어시 앱으로 돌아가는 중..." />
        <a href={intentUrl} className="text-sm font-semibold text-primary">
          앱이 안 열리면 여기를 누르세요
        </a>
        <a href={appUrl} className="text-xs text-muted-foreground">
          다른 방식으로 열기
        </a>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 px-4">
        <ErrorText>{error}</ErrorText>
        <Link to="/" className="text-sm font-semibold text-primary">
          홈으로 돌아가기
        </Link>
      </div>
    )
  }

  return <PageSpinner label="로그인 처리 중..." />
}
