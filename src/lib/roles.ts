import type { ProfileRole } from '../types/models'

/**
 * 슈퍼어드민인가 (플랫폼 관리 화면 + 모든 농가).
 *
 * 서버 util.ADMIN_ROLES, DB private.is_admin() 과 같은 규칙이어야 한다.
 * 전환 기간에는 옛 'admin' 도 받는다 (doc/admin-roles/sql/02~).
 * 일반 어드민(연결된 농가 1곳만)은 역할이 아니라 memberships 로 판단한다.
 */
export function isSuperAdminRole(role: ProfileRole | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin'
}
