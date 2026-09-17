import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { PageSpinner } from '../components/ui/Feedback'
import { farmNavItems } from '../config/farmNav'
import type { Farm } from '../types/models'
import { useAuth } from './auth'
import { createDevBypassFarm, isDevAuthBypass } from './devAuthBypass'
import { supabase } from './supabase'

interface FarmWorkspaceValue {
  farm: Farm
  basePath: string
  isAdminView: boolean
  refreshFarm: () => Promise<void>
}

const FarmWorkspaceContext = createContext<FarmWorkspaceValue | null>(null)

export function useFarmWorkspace() {
  const ctx = useContext(FarmWorkspaceContext)
  if (!ctx) throw new Error('useFarmWorkspace는 농가 워크스페이스 안에서만 사용할 수 있습니다.')
  return ctx
}

export function AdminFarmLayout() {
  const { farmId = '' } = useParams()
  const { isAdmin } = useAuth()
  const [farm, setFarm] = useState<Farm | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    if (isDevAuthBypass()) {
      // API 가 죽어도 URL 의 farmId 로 화면만 본다.
      setFarm(createDevBypassFarm(farmId))
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    supabase
      .from('farms')
      .select('*')
      .eq('id', farmId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setFarm((data as Farm) ?? null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [farmId])

  if (loading) return <PageSpinner />
  if (!farm) return <Navigate to={isAdmin ? '/admin/farms' : '/'} replace />

  return (
    <FarmWorkspaceProvider farm={farm} basePath={`/admin/farms/${farm.id}`} isAdminView={isAdmin}>
      <FarmShell />
    </FarmWorkspaceProvider>
  )
}

function FarmWorkspaceProvider({
  farm: farmProp,
  basePath,
  isAdminView,
  children,
}: {
  farm: Farm
  basePath: string
  isAdminView: boolean
  children: ReactNode
}) {
  const [farm, setFarm] = useState(farmProp)

  useEffect(() => {
    setFarm(farmProp)
  }, [farmProp])

  const refreshFarm = useCallback(async () => {
    const { data } = await supabase.from('farms').select('*').eq('id', farmProp.id).maybeSingle()
    if (data) setFarm(data as Farm)
  }, [farmProp.id])

  const value = useMemo<FarmWorkspaceValue>(
    () => ({ farm, basePath, isAdminView, refreshFarm }),
    [farm, basePath, isAdminView, refreshFarm],
  )

  return <FarmWorkspaceContext.Provider value={value}>{children}</FarmWorkspaceContext.Provider>
}

function FarmShell() {
  const { farm, basePath, isAdminView } = useFarmWorkspace()
  const navItems = isAdminView
    ? farmNavItems(basePath).filter((item) => !item.to.endsWith('/settings'))
    : farmNavItems(basePath)

  return (
    <AppShell
      navItems={navItems}
      roleLabel={isAdminView ? `관리자 · ${farm.name}` : '농가'}
      settingsPath={isAdminView ? '/admin/none' : `${basePath}/settings`}
    >
      <Outlet />
    </AppShell>
  )
}
