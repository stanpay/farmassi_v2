import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { PageSpinner } from '../ui/Feedback'
import { dismissPath, useLoginSheet } from './LoginSheet'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const { openLogin } = useLoginSheet()
  const next = `${location.pathname}${location.search}`

  useEffect(() => {
    if (loading || user) return
    openLogin({ next, dismissTo: dismissPath(location.pathname) })
  }, [loading, user, next, location.pathname, openLogin])

  if (loading) return <PageSpinner />
  if (!user) return <div className="min-h-dvh bg-surface" />
  return children
}

/**
 * 플랫폼 관리 화면(/admin, 농가 목록, 전역 주문·입금·송장·카카오톡 등). 슈퍼어드민만.
 * 일반 어드민(연결된 농가가 있는 계정)은 자기 농가 페이지로 보낸다 (기획 9.1·9.3).
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading, user, isAdmin, currentFarm } = useAuth()
  if (loading) return <PageSpinner />
  if (user && !isAdmin && currentFarm) return <Navigate to={`/admin/farms/${currentFarm.id}`} replace />
  if (!user || !isAdmin) return <Navigate to="/admin/login" replace />
  return children
}

export function RedirectToFarmWorkspace({ suffix }: { suffix?: string }) {
  const { loading, user, isAdmin, currentFarm } = useAuth()
  const location = useLocation()
  const { openLogin } = useLoginSheet()
  const next = `${location.pathname}${location.search}`

  useEffect(() => {
    if (loading || user) return
    openLogin({ next, dismissTo: '/' })
  }, [loading, user, next, openLogin])

  if (loading) return <PageSpinner />
  if (!user) return <div className="min-h-dvh bg-surface" />

  if (isAdmin && location.pathname.startsWith('/manage')) {
    return <Navigate to="/admin" replace />
  }

  const pathSuffix =
    suffix ?? (location.pathname.startsWith('/manage') ? location.pathname.replace(/^\/manage/, '') : '')
  if (currentFarm) {
    return <Navigate to={`/admin/farms/${currentFarm.id}${pathSuffix}${location.search}`} replace />
  }
  if (isAdmin) return <Navigate to="/admin" replace />
  return <Navigate to="/" replace />
}

export function RequireFarmWorkspace({ children }: { children: ReactNode }) {
  const { loading, user, isAdmin, memberships, currentFarm } = useAuth()
  const { farmId = '' } = useParams()
  const location = useLocation()
  const { openLogin } = useLoginSheet()
  const next = `${location.pathname}${location.search}`

  useEffect(() => {
    if (loading || user) return
    openLogin({ next, dismissTo: '/' })
  }, [loading, user, next, openLogin])

  if (loading) return <PageSpinner />
  if (!user) return <div className="min-h-dvh bg-surface" />
  if (isAdmin) return children
  if (memberships.some((row) => row.farm_id === farmId)) return children
  if (currentFarm) return <Navigate to={`/admin/farms/${currentFarm.id}`} replace />
  return <Navigate to="/" replace />
}
