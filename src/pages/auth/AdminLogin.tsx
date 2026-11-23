import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Header } from '../../components/layout/Header'
import { KakaoLoginButton } from '../../components/auth/KakaoLoginButton'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ErrorText } from '../../components/ui/Feedback'
import { useAuth } from '../../lib/auth'

export function AdminLogin() {
  const { isAdmin, user, loading, currentFarm, signInWithKakao, signOut } = useAuth()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  if (!loading && isAdmin) return <Navigate to="/admin" replace />
  // 일반 어드민(농가 연결만 있는 계정)은 자기 농가 페이지로 (기획 9.3).
  if (!loading && user && currentFarm) return <Navigate to={`/admin/farms/${currentFarm.id}`} replace />

  return (
    <div className="min-h-dvh bg-surface">
      <Header title="관리자 로그인" showBack backTo="/" />
      <div className="px-4 py-8 max-w-md mx-auto">
        <Card className="space-y-4">
          <p className="text-sm text-muted">지정된 카카오 계정만 관리자 페이지에 들어갈 수 있습니다.</p>
          {user && !isAdmin && (
            <ErrorText>이 계정은 관리자가 아니고 연결된 농가도 없습니다. 다른 카카오 계정으로 다시 로그인해 주세요.</ErrorText>
          )}
          <ErrorText>{error}</ErrorText>
          {user && !isAdmin ? (
            <Button
              type="button"
              fullWidth
              disabled={pending}
              onClick={() => {
                setPending(true)
                void signOut().finally(() => setPending(false))
              }}
            >
              로그아웃 후 다시 로그인
            </Button>
          ) : (
            <KakaoLoginButton
              disabled={pending}
              onClick={() => {
                setError('')
                setPending(true)
                void signInWithKakao('/admin').catch((err) => {
                  setError(err instanceof Error ? err.message : '로그인에 실패했습니다.')
                  setPending(false)
                })
              }}
            />
          )}
        </Card>
      </div>
    </div>
  )
}
