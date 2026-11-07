import { normalizePhone } from './phone'
import type { Profile } from '../types/models'

export const PROFILE_PENDING_KEY = 'farmassi-profile-pending'

export function markProfilePending() {
  sessionStorage.setItem(PROFILE_PENDING_KEY, '1')
}

export function clearProfilePending() {
  sessionStorage.removeItem(PROFILE_PENDING_KEY)
}

export function isProfilePending() {
  return sessionStorage.getItem(PROFILE_PENDING_KEY) === '1'
}

/** 전화번호가 아직 없으면 추가 정보 입력이 필요하다. */
export function profileNeedsCompletion(profile: Profile | null | undefined) {
  if (!profile) return false
  return !profile.phone?.trim()
}

export function isProfileNameValid(name: string) {
  return name.trim().length >= 2
}

export function isProfilePhoneValid(phone: string) {
  return Boolean(normalizePhone(phone))
}

export function normalizeProfilePhone(phone: string) {
  return normalizePhone(phone)
}
