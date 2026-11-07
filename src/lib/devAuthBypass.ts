import type { Profile } from '../types/models'
import type { Session } from './apiClient'

/** `npm run dev` + VITE_DEV_BYPASS_AUTH=true 일 때만. 프로덕션 빌드에는 절대 켜지지 않는다. */
export function isDevAuthBypass(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'
}

export const DEV_BYPASS_USER_ID = '00000000-0000-4000-8000-0000000000ad'

export const DEV_BYPASS_SESSION: Session = {
  access_token: 'dev-bypass-token',
  user: { id: DEV_BYPASS_USER_ID },
}

export const DEV_BYPASS_PROFILE: Profile = {
  id: DEV_BYPASS_USER_ID,
  role: 'admin',
  display_name: '로컬 관리자',
  phone: '010-0000-0000',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}
