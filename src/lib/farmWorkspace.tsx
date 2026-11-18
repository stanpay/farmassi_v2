import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { PageSpinner } from '../components/ui/Feedback'
import { farmNavItems } from '../config/farmNav'
import type { Farm } from '../types/models'
import { isAutoSmsNative, loadAutoSmsConfig, saveAutoSmsConfig } from './autoSms'
import { parseAutoSmsStored } from './callbackRules'
import { resolveFarmShareText } from './farmShareText'
import { useAuth } from './auth'
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

    // 로그인 우회여도 농가 데이터는 DB에서 읽는다. (더미 '초록빛 농장'으로 덮지 않음)
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

  useEffect(() => {
    if (!isAutoSmsNative()) return
    let cancelled = false
    void (async () => {
      const message = resolveFarmShareText(farm)
      const fromDb = parseAutoSmsStored(farm.auto_sms, message)
      const device = await loadAutoSmsConfig(message)
      if (cancelled) return
      await saveAutoSmsConfig({ ...fromDb, master: device.master, message })
    })()
    return () => {
      cancelled = true
    }
    // 객체 참조가 바뀌어도 내용이 같으면 다시 쓰지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- farm 필드 중 문자에 쓰는 것만
  }, [farm.id, farm.share_text, JSON.stringify(farm.auto_sms ?? {})])

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
