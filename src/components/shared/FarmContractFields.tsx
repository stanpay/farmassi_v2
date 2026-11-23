import { useEffect, useMemo, useRef, useState } from 'react'
import { Input, Select } from '../ui/Field'
import type { Profile } from '../../types/models'

// admin/Farms.tsx 안에만 있던 것을 계약 페이지에서도 쓰려고 꺼냈다.

export type ProfileOption = Pick<Profile, 'id' | 'display_name' | 'phone' | 'avatar_url'>

const BANK_CUSTOM = '__custom__'
const BANKS = [
  '국민은행',
  '신한은행',
  '우리은행',
  '하나은행',
  'NH농협은행',
  '기업은행',
  '카카오뱅크',
  '토스뱅크',
  '케이뱅크',
  '부산은행',
  'iM뱅크',
  '경남은행',
  '광주은행',
  '전북은행',
  '제주은행',
  '수협은행',
  'SC제일은행',
  '한국씨티은행',
  '산업은행',
  '우체국',
  '새마을금고',
  '신협',
] as const

export function BankField({
  value,
  onChange,
  required,
}: {
  value: string
  onChange: (value: string) => void
  required?: boolean
}) {
  const listed = BANKS.includes(value as (typeof BANKS)[number])
  const selectValue = listed ? value : BANK_CUSTOM

  return (
    <div className="space-y-2">
      <Select
        label="은행"
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value
          if (next === BANK_CUSTOM) {
            onChange(listed ? '' : value)
            return
          }
          onChange(next)
        }}
        required={required}
      >
        <option value={BANK_CUSTOM}>직접입력</option>
        {BANKS.map((bank) => (
          <option key={bank} value={bank}>
            {bank}
          </option>
        ))}
      </Select>
      {selectValue === BANK_CUSTOM && (
        <Input
          label="은행명"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="은행명을 입력하세요"
          required={required}
        />
      )}
    </div>
  )
}

export function profileLabel(profile: ProfileOption | undefined) {
  if (!profile) return '미지정'
  const name = profile.display_name?.trim() || '이름 없음'
  return profile.phone ? `${name} · ${profile.phone}` : name
}

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const PAGE_SIZE = 30

// '박지훈' → 'ㅂㅈㅎ'. 한글 음절이 아닌 글자는 그대로 둔다.
function toChoseong(text: string) {
  let out = ''
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00
    out += code >= 0 && code < 11172 ? CHOSEONG[Math.floor(code / 588)] : ch
  }
  return out
}

const isChoseongOnly = (text: string) => /^[ㄱ-ㅎ]+$/.test(text)

function matchesQuery(profile: ProfileOption, q: string) {
  const name = (profile.display_name ?? '').toLowerCase().replace(/\s/g, '')
  const compact = q.replace(/\s/g, '')
  if (!compact) return true
  if (name.includes(compact)) return true
  if (isChoseongOnly(compact) && toChoseong(name).includes(compact)) return true
  const digits = compact.replace(/-/g, '')
  if (/^\d+$/.test(digits) && (profile.phone ?? '').replace(/[\s-]/g, '').includes(digits)) return true
  return profile.id.toLowerCase().includes(compact)
}

/**
 * 계정 고르기. 여러 명을 연결할 수 있다 (기획 8.1).
 *
 * - 검색해서 누르면 '추가' 다 (교체가 아니다). 이미 고른 계정은 다시 눌러도 추가하지 않는다.
 * - 고른 계정마다 '해제'.
 * - note 로 목록 항목 옆에 안내를 붙일 수 있다 (예: 다른 농가에 연결됨). 막지는 않는다 —
 *   실제 거부는 DB(농가 1곳 제한)가 하고 그 사유를 화면에 보여 준다.
 */
export function AccountPicker({
  profiles,
  selectedIds,
  onAdd,
  onRemove,
  note,
  badge,
  label = '담당 계정',
  disabled = false,
}: {
  profiles: ProfileOption[]
  selectedIds: string[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  note?: (profile: ProfileOption) => string | null | undefined
  badge?: (profile: ProfileOption) => string | null | undefined
  label?: string
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const listRef = useRef<HTMLUListElement>(null)
  const sentinelRef = useRef<HTMLLIElement>(null)
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selected = selectedIds
    .map((id) => profiles.find((p) => p.id === id) ?? ({ id, display_name: null, phone: null, avatar_url: null } as ProfileOption))
  const q = query.trim().toLowerCase()

  // 이름이 없는 계정은 가입만 하고 프로필을 채우지 않은 것이라 고를 수 없게 뺀다.
  const named = useMemo(() => profiles.filter((p) => p.display_name?.trim()), [profiles])
  const matches = useMemo(() => (q ? named.filter((p) => matchesQuery(p, q)) : named), [named, q])
  const shown = matches.slice(0, visibleCount)
  const hasMore = shown.length < matches.length

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    listRef.current?.scrollTo({ top: 0 })
  }, [q])

  // 목록 끝이 스크롤 영역에 들어오면 다음 묶음을 더 그린다.
  useEffect(() => {
    const root = listRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisibleCount((n) => n + PAGE_SIZE)
      },
      { root, rootMargin: '80px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, shown.length])

  return (
    <div className="space-y-2">
      <Input
        label={label}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름 검색 (예: 박지훈, ㅂㅈㅎ) · 연락처"
        autoComplete="off"
      />
      {selected.length > 0 && (
        <ul className="space-y-1.5" aria-label="연결된 계정">
          {selected.map((profile) => (
            <li
              key={profile.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-primary-light px-3 py-2 text-sm"
            >
              <span className="font-medium text-primary">
                {profileLabel(profile)}
                {badge?.(profile) && (
                  <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[11px] text-muted">{badge(profile)}</span>
                )}
              </span>
              <button
                type="button"
                className="text-xs text-muted disabled:opacity-50"
                disabled={disabled}
                onClick={() => onRemove(profile.id)}
              >
                해제
              </button>
            </li>
          ))}
        </ul>
      )}
      {matches.length > 0 ? (
        <>
          <p className="text-xs text-muted">
            {q ? `검색 결과 ${matches.length}명` : `전체 ${matches.length}명`}
          </p>
          <ul
            ref={listRef}
            className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100"
          >
            {shown.map((profile: ProfileOption) => (
              <li key={profile.id}>
                <button
                  type="button"
                  disabled={disabled}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 ${
                    selectedSet.has(profile.id) ? 'bg-primary-light font-medium' : ''
                  }`}
                  onClick={() => {
                    if (!selectedSet.has(profile.id)) onAdd(profile.id)
                    setQuery('')
                  }}
                >
                  {profileLabel(profile)}
                  {selectedSet.has(profile.id) && <span className="ml-2 text-xs text-primary">연결됨</span>}
                  {!selectedSet.has(profile.id) && note?.(profile) && (
                    <span className="ml-2 text-xs text-muted">{note(profile)}</span>
                  )}
                </button>
              </li>
            ))}
            {hasMore && (
              <li ref={sentinelRef} className="px-3 py-2 text-center text-xs text-muted">
                불러오는 중…
              </li>
            )}
          </ul>
        </>
      ) : (
        <p className="text-xs text-muted">{q ? '일치하는 계정이 없습니다.' : '카카오로 로그인한 계정 목록입니다.'}</p>
      )}
    </div>
  )
}
