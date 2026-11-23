import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../ui/Button'
import { Input } from '../ui/Field'
import { PhoneField } from '../ui/PhoneField'
import { ErrorText } from '../ui/Feedback'
import { useAuth } from '../../lib/auth'
import {
  clearProfilePending,
  isProfileNameValid,
  isProfilePhoneValid,
  normalizeProfilePhone,
} from '../../lib/profileCompletion'
import { notifySignupAlimtalk } from '../../lib/alimtalk'
import { supabase } from '../../lib/supabase'

interface ProfileCompletionSheetProps {
  open: boolean
  onCompleted: () => void
}

export function ProfileCompletionSheet({ open, onCompleted }: ProfileCompletionSheetProps) {
  const { profile, refresh } = useAuth()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open || !profile) return
    setName(profile.display_name?.trim() ?? '')
    setPhone(profile.phone?.trim() ?? '')
    setError('')
    setPending(false)
  }, [open, profile])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open || !profile) return null

  async function save() {
    if (!profile) return
    setError('')
    const trimmedName = name.trim()
    const trimmedPhone = normalizeProfilePhone(phone)
    const profileId = profile.id
    const hadPhone = Boolean(profile.phone?.trim())

    if (!isProfileNameValid(trimmedName)) {
      setError('이름을 2글자 이상 입력해 주세요.')
      return
    }
    if (!isProfilePhoneValid(trimmedPhone)) {
      setError('연락처를 올바르게 입력해 주세요.')
      return
    }

    setPending(true)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ display_name: trimmedName, phone: trimmedPhone })
      .eq('id', profileId)

    if (updateError) {
      setError(updateError.message)
      setPending(false)
      return
    }

    // 연락처가 비어 있던 사람이 처음 저장할 때만. 서버도 사용자당 1번만 보낸다.
    if (!hadPhone) notifySignupAlimtalk()

    clearProfilePending()
    await refresh()
    setPending(false)
    onCompleted()
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="회원 정보 입력"
        className="animate-sheet-up relative w-full max-w-md rounded-t-3xl bg-white px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,0.12)] sm:rounded-3xl sm:mx-4"
      >
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-gray-200 sm:hidden" />
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold">회원 정보 입력</h2>
            <p className="mt-1 text-sm text-muted">
              주문·입금 확인을 위해 이름과 연락처를 입력해 주세요. 입력한 정보는 이 카카오 계정에
              저장됩니다.
            </p>
          </div>
          <Input
            label="이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="실명 또는 입금자명"
            autoComplete="name"
            required
          />
          <PhoneField label="연락처" value={phone} onChange={setPhone} required />
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" disabled={pending} onClick={() => void save()}>
            {pending ? '저장 중...' : '저장하고 계속'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
