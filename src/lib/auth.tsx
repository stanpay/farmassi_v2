import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import {
  DEV_BYPASS_PROFILE,
  DEV_BYPASS_SESSION,
  isDevAuthBypass,
} from './devAuthBypass'
import type { Farm, FarmMemberRole, Profile } from '../types/models'
import type { Session, User } from './apiClient'

interface FarmMembership {
  farm_id: string
  member_role: FarmMemberRole
  farm: Farm
}

interface AuthState {
  loading: boolean
  session: Session | null
  user: User | null
  profile: Profile | null
  memberships: FarmMembership[]
  currentFarm: Farm | null
  isAdmin: boolean
  isFarmUser: boolean
  refresh: () => Promise<void>
  signInWithKakao: (next?: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

async function loadUserState(user: User | null) {
  if (!user) {
    return {
      profile: null as Profile | null,
      memberships: [] as FarmMembership[],
    }
  }

  const [profileRes, memberRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('farm_members').select('farm_id, member_role').eq('user_id', user.id),
  ])

  const memberRows = memberRes.data ?? []
  const farmIds = memberRows.map((row: any) => row.farm_id as string)
  const farmsById = new Map<string, Farm>()
  if (farmIds.length > 0) {
    const { data: farmRows } = await supabase.from('farms').select('*').in('id', farmIds)
    for (const farm of (farmRows as Farm[]) ?? []) farmsById.set(farm.id, farm)
  }

  const memberships: FarmMembership[] = memberRows
    .map((row: any) => {
      const farm = farmsById.get(row.farm_id as string)
      if (!farm) return null
      return {
        farm_id: row.farm_id as string,
        member_role: row.member_role as FarmMemberRole,
        farm,
      }
    })
    .filter((row: FarmMembership | null): row is FarmMembership => row !== null)

  return {
    profile: (profileRes.data as Profile | null) ?? null,
    memberships,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<FarmMembership[]>([])

  const hydrate = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession)
    const state = await loadUserState(nextSession?.user ?? null)
    setProfile(state.profile)
    setMemberships(state.memberships)
  }, [])

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await hydrate(data.session)
  }, [hydrate])

  useEffect(() => {
    let mounted = true

    if (isDevAuthBypass()) {
      setSession(DEV_BYPASS_SESSION)
      setProfile(DEV_BYPASS_PROFILE)
      setMemberships([])
      setLoading(false)
      return () => {
        mounted = false
      }
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      await hydrate(data.session)
      if (mounted) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      void hydrate(next)
    })
    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [hydrate])

  const signInWithKakao = useCallback(async (next?: string) => {
    if (isDevAuthBypass()) return
    if (next) sessionStorage.setItem('farmassi-next', next)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'profile_nickname profile_image',
      },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    if (isDevAuthBypass()) return
    await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthState>(() => {
    const user = session?.user ?? null
    return {
      loading,
      session,
      user,
      profile,
      memberships,
      currentFarm: memberships[0]?.farm ?? null,
      isAdmin: profile?.role === 'admin',
      isFarmUser: memberships.length > 0,
      refresh,
      signInWithKakao,
      signOut,
    }
  }, [
    loading,
    session,
    profile,
    memberships,
    refresh,
    signInWithKakao,
    signOut,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth는 AuthProvider 안에서만 사용할 수 있습니다.')
  return ctx
}
