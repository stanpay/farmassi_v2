import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { Header } from '../../components/layout/Header'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Input, Textarea } from '../../components/ui/Field'
import { DeliveryDaysField } from '../../components/shared/DeliveryDaysField'
import { normalizeDeliveryDays } from '../../lib/deliveryDays'
import { PhoneField } from '../../components/ui/PhoneField'
import { ErrorText } from '../../components/ui/Feedback'
import {
  createLandingBlock,
  draftsFromLandingBlocks,
  LandingBlocksField,
  persistLandingBlocks,
  cleanupLandingImages,
  type LandingBlockDraft,
} from '../../components/shared/LandingBlocksField'
import { AddressPicker } from '../../components/shared/AddressPicker'
import {
  AccountPicker,
  BankField,
  profileLabel,
  type ProfileOption,
} from '../../components/shared/FarmContractFields'
import { AccountQrDownloadButton } from '../../components/shared/AccountQrDownloadButton'
import { BankdaAccountLink } from '../../components/shared/BankdaAccountLink'
import { FarmSharePreview } from '../../components/shared/FarmSharePreview'
import { adminNavItems } from '../../config/adminNav'
import { kakaoChannelHref, safeHttpUrl } from '../../lib/format'
import { farmLandingPath, resolveFarmShareText } from '../../lib/farmShareText'
import { toSlug } from '../../lib/slug'
import { supabase } from '../../lib/supabase'
import { parseLandingBlocks, type Farm } from '../../types/models'


interface FarmForm {
  name: string
  slug: string
  location: string
  product_summary: string
  description: string
  phone: string
  mobile_phone: string
  address: string
  address_zonecode: string
  address_detail: string
  map_url: string
  share_text: string
  kakao_channel_url: string
  bank_name: string
  account_number: string
  account_holder: string
  owner_user_id: string
  is_active: boolean
  delivery_days: number[]
}

const emptyForm: FarmForm = {
  name: '',
  slug: '',
  location: '',
  product_summary: '',
  description: '',
  phone: '',
  mobile_phone: '',
  address: '',
  address_zonecode: '',
  address_detail: '',
  map_url: '',
  share_text: '',
  kakao_channel_url: '',
  bank_name: '',
  account_number: '',
  account_holder: '',
  owner_user_id: '',
  is_active: true,
  delivery_days: [],
}

const RESERVED_SLUGS = new Set([
  'admin',
  'apply',
  'auth',
  'delivery',
  'farm',
  'login',
  'manage',
  'me',
  'o',
  'orders',
  'products',
  'settings',
  'shop',
  'store',
])



const farmAddressPickerCopy = {
  emptyHint: '농가 위치를 현재 위치 또는 검색으로 설정해 주세요',
  searchTitle: '농가 주소 검색',
  detailPlaceholder: '건물명, 동·호수 등',
} as const


function uniqueSlug(name: string, taken: Set<string>, current?: string) {
  const base = toSlug(name) || 'farm'
  const blocked = (slug: string) => slug !== current && (taken.has(slug) || RESERVED_SLUGS.has(slug))
  if (!blocked(base)) return base
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}



export function AdminFarms() {
  const navigate = useNavigate()
  const [farms, setFarms] = useState<Farm[]>([])
  const [profiles, setProfiles] = useState<ProfileOption[]>([])
  const [editing, setEditing] = useState<Farm | null>(null)
  const [bindFarmId, setBindFarmId] = useState<string | null>(null)
  const [bindUserId, setBindUserId] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<FarmForm>(emptyForm)
  const [createLanding, setCreateLanding] = useState<LandingBlockDraft[]>([createLandingBlock()])
  const [editLanding, setEditLanding] = useState<LandingBlockDraft[]>([createLandingBlock()])
  const [slugTouched, setSlugTouched] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [visibilityTarget, setVisibilityTarget] = useState<Farm | null>(null)
  const [visibilityPending, setVisibilityPending] = useState(false)
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'active' | 'inactive'>('active')

  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])
  const takenSlugs = useMemo(() => new Set(farms.map((f) => f.slug)), [farms])
  const activeCount = useMemo(() => farms.filter((farm) => farm.is_active).length, [farms])
  const visibleFarms = useMemo(() => {
    if (visibilityFilter === 'active') return farms.filter((farm) => farm.is_active)
    if (visibilityFilter === 'inactive') return farms.filter((farm) => !farm.is_active)
    return farms
  }, [farms, visibilityFilter])

  async function load() {
    const [farmRes, profileRes] = await Promise.all([
      supabase.from('farms').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, display_name, phone, avatar_url').order('display_name'),
    ])
    setFarms(
      ((farmRes.data as Farm[]) ?? []).map((farm) => ({
        ...farm,
        landing_blocks: parseLandingBlocks(farm.landing_blocks),
      })),
    )
    setProfiles((profileRes.data as ProfileOption[]) ?? [])
  }

  useEffect(() => {
    void load()
  }, [])

  function resetCreate() {
    setForm(emptyForm)
    setCreateLanding([createLandingBlock()])
    setSlugTouched(false)
    setShowCreate(false)
  }

  async function bindOwner(farmId: string, userId: string) {
    const { error: farmError } = await supabase.from('farms').update({ owner_user_id: userId }).eq('id', farmId)
    if (farmError) throw farmError
    const { error: memberError } = await supabase.from('farm_members').upsert(
      { farm_id: farmId, user_id: userId, member_role: 'owner' },
      { onConflict: 'farm_id,user_id' },
    )
    if (memberError) throw memberError
  }

  async function createFarm() {
    setError('')
    if (!form.name.trim()) {
      setError('농가명을 입력하세요.')
      return
    }
    if (!form.owner_user_id) {
      setError('담당 계정을 선택하세요.')
      return
    }
    if (!form.bank_name.trim() || !form.account_number.trim() || !form.account_holder.trim()) {
      setError('입금 계좌 정보를 모두 입력하세요.')
      return
    }
    // 예상 배송일 계산에 쓰이므로 하나는 있어야 한다.
    if (normalizeDeliveryDays(form.delivery_days).length === 0) {
      setError('배송 가능 요일을 하나 이상 선택하세요.')
      return
    }
    setPending(true)
    const slug = uniqueSlug(form.slug.trim() || form.name, takenSlugs)
    const { data: farm, error: farmError } = await supabase
      .from('farms')
      .insert({
        slug,
        name: form.name.trim(),
        owner_user_id: form.owner_user_id,
        location: form.location.trim() || null,
        product_summary: form.product_summary.trim() || null,
        description: form.description.trim() || null,
        kakao_channel_url: kakaoChannelHref(form.kakao_channel_url),
        phone: form.phone.trim() || null,
        mobile_phone: form.mobile_phone.trim() || null,
        address: form.address.trim() || null,
        address_zonecode: form.address_zonecode.trim() || null,
        address_detail: form.address_detail.trim() || null,
        map_url: safeHttpUrl(form.map_url),
        share_text:
          resolveFarmShareText({
            name: form.name,
            slug,
            description: form.description,
            product_summary: form.product_summary,
            phone: form.phone,
            mobile_phone: form.mobile_phone,
            address: form.address,
            address_zonecode: form.address_zonecode,
            address_detail: form.address_detail,
            map_url: form.map_url,
            share_text: form.share_text,
          }) || null,
        bank_name: form.bank_name.trim(),
        account_number: form.account_number.trim(),
        account_holder: form.account_holder.trim(),
        delivery_days: form.delivery_days,
        is_active: form.is_active,
      })
      .select('id')
      .single()
    if (farmError || !farm) {
      setPending(false)
      setError(farmError?.message ?? '농가 생성에 실패했습니다.')
      return
    }
    const { error: memberError } = await supabase.from('farm_members').insert({
      farm_id: farm.id,
      user_id: form.owner_user_id,
      member_role: 'owner',
    })
    if (memberError) {
      await supabase.from('farms').delete().eq('id', farm.id)
      setPending(false)
      setError(memberError.message)
      return
    }
    try {
      const { blocks: landing_blocks, obsolete } = await persistLandingBlocks(farm.id, createLanding, [])
      const { error: landingError } = await supabase.from('farms').update({ landing_blocks }).eq('id', farm.id)
      if (landingError) throw landingError
      void cleanupLandingImages(obsolete)
    } catch (err) {
      setPending(false)
      setError(err instanceof Error ? err.message : '랜딩페이지 이미지 업로드에 실패했습니다.')
      resetCreate()
      await load()
      return
    }
    setPending(false)
    resetCreate()
    await load()
  }

  async function toggleVisibility() {
    if (!visibilityTarget || visibilityPending) return
    setError('')
    setVisibilityPending(true)
    const { error: updateError } = await supabase
      .from('farms')
      .update({ is_active: !visibilityTarget.is_active })
      .eq('id', visibilityTarget.id)
    setVisibilityPending(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setVisibilityTarget(null)
    await load()
  }

  return (
    <AppShell navItems={adminNavItems} roleLabel="관리자" settingsPath="/admin/none">
      <Header
        title="농가"
        subtitle={`${visibleFarms.length}곳`}
        rightElement={
          <Button
            size="sm"
            onClick={() => {
              setCreateLanding([createLandingBlock()])
              setShowCreate(true)
            }}
          >
            농가 추가
          </Button>
        }
      />
      <div className="px-4 py-4 md:px-6 max-w-5xl mx-auto space-y-3">
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {(
            [
              { id: 'all' as const, label: '전체', count: farms.length },
              { id: 'active' as const, label: '활성화', count: activeCount },
              { id: 'inactive' as const, label: '비활성화', count: farms.length - activeCount },
            ] as const
          ).map(({ id, label, count }) => (
            <button
              key={id}
              type="button"
              onClick={() => setVisibilityFilter(id)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                visibilityFilter === id ? 'bg-primary text-white' : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {label}
              <span className="ml-1 text-xs opacity-70">({count})</span>
            </button>
          ))}
        </div>

        {showCreate && (
          <Card className="space-y-3">
            <h3 className="font-semibold">새 농가</h3>
            <Input
              label="농가명"
              value={form.name}
              onChange={(e) => {
                const name = e.target.value
                setForm((prev) => ({
                  ...prev,
                  name,
                  slug: slugTouched ? prev.slug : toSlug(name),
                }))
              }}
              required
            />
            <div>
              <Input
                label="주문 페이지 주소"
                value={form.slug}
                onChange={(e) => {
                  const slug = toSlug(e.target.value)
                  setSlugTouched(slug.length > 0)
                  setForm((prev) => ({ ...prev, slug }))
                }}
                placeholder="jeju-nongjang"
              />
              <p className="mt-1 text-xs text-muted">/farm/{form.slug || '...'}</p>
            </div>
            <Input
              label="지역"
              value={form.location}
              onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
            />
            <Input
              label="주요 품목"
              value={form.product_summary}
              onChange={(e) => setForm((prev) => ({ ...prev, product_summary: e.target.value }))}
              placeholder="감귤, 한라봉"
            />
            <Textarea
              label="소개"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="전화주셔서 감사합니다. 세계가 인정한 믿고 먹을 수 있는 포도즙"
            />
            <PhoneField
              label="전화번호"
              value={form.phone}
              onChange={(phone) => setForm((prev) => ({ ...prev, phone }))}
            />
            <PhoneField
              label="휴대폰"
              value={form.mobile_phone}
              onChange={(mobile_phone) => setForm((prev) => ({ ...prev, mobile_phone }))}
            />
            <AddressPicker
              value={{
                zonecode: form.address_zonecode,
                address: form.address,
                addressDetail: form.address_detail,
              }}
              onChange={(next) =>
                setForm((prev) => ({
                  ...prev,
                  address_zonecode: next.zonecode,
                  address: next.address,
                  address_detail: next.addressDetail,
                }))
              }
              {...farmAddressPickerCopy}
            />
            <Input
              label="네이버지도 길안내"
              value={form.map_url}
              onChange={(e) => setForm((prev) => ({ ...prev, map_url: e.target.value }))}
              placeholder="https://naver.me/..."
            />
            <FarmSharePreview
              farm={{
                name: form.name,
                slug: form.slug,
                description: form.description,
                product_summary: form.product_summary,
                phone: form.phone,
                mobile_phone: form.mobile_phone,
                address: form.address,
                address_zonecode: form.address_zonecode,
                address_detail: form.address_detail,
                map_url: form.map_url,
              }}
              value={form.share_text}
              onChange={(share_text) => setForm((prev) => ({ ...prev, share_text }))}
            />
            <LandingBlocksField
              blocks={createLanding}
              onChange={setCreateLanding}
              slug={form.slug}
              onError={setError}
            />
            <Input
              label="카카오톡 비즈니스 프로필"
              value={form.kakao_channel_url}
              onChange={(e) => setForm((prev) => ({ ...prev, kakao_channel_url: e.target.value }))}
              placeholder="https://pf.kakao.com/_xxxxx"
            />
            <DeliveryDaysField
              value={form.delivery_days}
              onChange={(delivery_days) => setForm((prev) => ({ ...prev, delivery_days }))}
            />
            <BankField
              value={form.bank_name}
              onChange={(bank_name) => setForm((prev) => ({ ...prev, bank_name }))}
              required
            />
            <Input
              label="계좌 · 하이픈(-) 포함해서 작성"
              value={form.account_number}
              onChange={(e) => setForm((prev) => ({ ...prev, account_number: e.target.value }))}
              placeholder="하이픈(-) 포함해서 입력 (예: 227052-51-003379)"
              required
            />
            <Input
              label="예금주"
              value={form.account_holder}
              onChange={(e) => setForm((prev) => ({ ...prev, account_holder: e.target.value }))}
              required
            />
            <AccountQrDownloadButton
              farmName={form.name}
              bankName={form.bank_name}
              accountNumber={form.account_number}
              accountHolder={form.account_holder}
              farmSlug={form.slug}
            />
            <AccountPicker
              profiles={profiles}
              selectedId={form.owner_user_id}
              onSelect={(id) => setForm((prev) => ({ ...prev, owner_user_id: id }))}
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={pending} onClick={() => void createFarm()}>
                생성
              </Button>
              <Button size="sm" variant="ghost" onClick={resetCreate}>
                취소
              </Button>
            </div>
          </Card>
        )}

        {visibleFarms.map((farm) => (
          <Card
            key={farm.id}
            className="space-y-2"
            onClick={
              editing?.id === farm.id || bindFarmId === farm.id
                ? undefined
                : () => navigate(`/admin/farms/${farm.id}`)
            }
          >
            {editing?.id === farm.id ? (
              <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                <Input
                  label="농가명"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
                <Input
                  label="주문 페이지 주소"
                  value={editing.slug}
                  onChange={(e) => setEditing({ ...editing, slug: toSlug(e.target.value) })}
                />
                <p className="text-xs text-muted">/farm/{toSlug(editing.slug) || farm.slug}</p>
                <Input
                  label="지역"
                  value={editing.location ?? ''}
                  onChange={(e) => setEditing({ ...editing, location: e.target.value })}
                />
                <Input
                  label="주요 품목"
                  value={editing.product_summary ?? ''}
                  onChange={(e) => setEditing({ ...editing, product_summary: e.target.value })}
                />
                <Textarea
                  label="소개"
                  value={editing.description ?? ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="전화주셔서 감사합니다. 세계가 인정한 믿고 먹을 수 있는 포도즙"
                />
                <PhoneField
                  label="전화번호"
                  value={editing.phone ?? ''}
                  onChange={(phone) => setEditing({ ...editing, phone })}
                />
                <PhoneField
                  label="휴대폰"
                  value={editing.mobile_phone ?? ''}
                  onChange={(mobile_phone) => setEditing({ ...editing, mobile_phone })}
                />
                <AddressPicker
                  value={{
                    zonecode: editing.address_zonecode ?? '',
                    address: editing.address ?? '',
                    addressDetail: editing.address_detail ?? '',
                  }}
                  onChange={(next) =>
                    setEditing({
                      ...editing,
                      address_zonecode: next.zonecode,
                      address: next.address,
                      address_detail: next.addressDetail,
                    })
                  }
                  {...farmAddressPickerCopy}
                />
                <Input
                  label="네이버지도 길안내"
                  value={editing.map_url ?? ''}
                  onChange={(e) => setEditing({ ...editing, map_url: e.target.value })}
                  placeholder="https://naver.me/..."
                />
                <FarmSharePreview
                  farm={{
                    name: editing.name,
                    slug: toSlug(editing.slug) || farm.slug,
                    description: editing.description,
                    product_summary: editing.product_summary,
                    phone: editing.phone,
                    mobile_phone: editing.mobile_phone,
                    address: editing.address,
                    address_zonecode: editing.address_zonecode,
                    address_detail: editing.address_detail,
                    map_url: editing.map_url,
                  }}
                  value={editing.share_text ?? ''}
                  onChange={(share_text) => setEditing((prev) => (prev ? { ...prev, share_text } : prev))}
                />
                <LandingBlocksField
                  blocks={editLanding}
                  onChange={setEditLanding}
                  slug={editing.slug}
                  onError={setError}
                />
                <Input
                  label="카카오톡 비즈니스 프로필"
                  value={editing.kakao_channel_url ?? ''}
                  onChange={(e) => setEditing({ ...editing, kakao_channel_url: e.target.value })}
                  placeholder="https://pf.kakao.com/_xxxxx"
                />
                <DeliveryDaysField
                  value={editing.delivery_days ?? []}
                  onChange={(delivery_days) => setEditing({ ...editing, delivery_days })}
                />
                <BankField
                  value={editing.bank_name}
                  onChange={(bank_name) => setEditing({ ...editing, bank_name })}
                />
                <Input
                  label="계좌 · 하이픈(-) 포함해서 작성"
                  value={editing.account_number}
                  onChange={(e) => setEditing({ ...editing, account_number: e.target.value })}
                  placeholder="하이픈(-) 포함해서 입력 (예: 227052-51-003379)"
                />
                <Input
                  label="예금주"
                  value={editing.account_holder}
                  onChange={(e) => setEditing({ ...editing, account_holder: e.target.value })}
                />
                <AccountQrDownloadButton
                  farmName={editing.name}
                  bankName={editing.bank_name}
                  accountNumber={editing.account_number}
                  accountHolder={editing.account_holder}
                  farmSlug={toSlug(editing.slug) || farm.slug}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={async () => {
                      setError('')
                      const slug = toSlug(editing.slug) || farm.slug
                      if (RESERVED_SLUGS.has(slug) && slug !== farm.slug) {
                        setError('이 주문 페이지 주소는 사용할 수 없습니다.')
                        return
                      }
                      if (normalizeDeliveryDays(editing.delivery_days).length === 0) {
                        setError('배송 가능 요일을 하나 이상 선택하세요.')
                        return
                      }
                      setPending(true)
                      try {
                        const { blocks: landing_blocks, obsolete } = await persistLandingBlocks(
                          farm.id,
                          editLanding,
                          parseLandingBlocks(farm.landing_blocks),
                        )
                        const { error: updateError } = await supabase
                          .from('farms')
                          .update({
                            name: editing.name,
                            slug,
                            location: editing.location?.trim() || null,
                            product_summary: editing.product_summary?.trim() || null,
                            description: editing.description?.trim() || null,
                            kakao_channel_url: kakaoChannelHref(editing.kakao_channel_url),
                            phone: editing.phone?.trim() || null,
                            mobile_phone: editing.mobile_phone?.trim() || null,
                            address: editing.address?.trim() || null,
                            address_zonecode: editing.address_zonecode?.trim() || null,
                            address_detail: editing.address_detail?.trim() || null,
                            map_url: safeHttpUrl(editing.map_url),
                            share_text:
                              resolveFarmShareText({
                                name: editing.name,
                                slug,
                                description: editing.description,
                                product_summary: editing.product_summary,
                                phone: editing.phone,
                                mobile_phone: editing.mobile_phone,
                                address: editing.address,
                                address_zonecode: editing.address_zonecode,
                                address_detail: editing.address_detail,
                                map_url: editing.map_url,
                                share_text: editing.share_text,
                              }) || null,
                            landing_blocks,
                            bank_name: editing.bank_name,
                            account_number: editing.account_number.trim(),
                            account_holder: editing.account_holder,
                            delivery_days: normalizeDeliveryDays(editing.delivery_days),
                          })
                          .eq('id', farm.id)
                        if (updateError) {
                          setError(updateError.message)
                          return
                        }
                        void cleanupLandingImages(obsolete)
                        setEditing(null)
                        await load()
                      } catch (err) {
                        setError(err instanceof Error ? err.message : '랜딩페이지 이미지 업로드에 실패했습니다.')
                      } finally {
                        setPending(false)
                      }
                    }}
                  >
                    저장
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    취소
                  </Button>
                </div>
              </div>
            ) : bindFarmId === farm.id ? (
              <div className="space-y-3">
                <p className="font-bold">{farm.name}</p>
                <AccountPicker
                  profiles={profiles}
                  selectedId={bindUserId}
                  onSelect={setBindUserId}
                  label="연결할 계정"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending || !bindUserId}
                    onClick={async () => {
                      setError('')
                      setPending(true)
                      try {
                        await bindOwner(farm.id, bindUserId)
                        setBindFarmId(null)
                        setBindUserId('')
                        await load()
                      } catch (err) {
                        setError(err instanceof Error ? err.message : '계정 연결에 실패했습니다.')
                      } finally {
                        setPending(false)
                      }
                    }}
                  >
                    연결
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setBindFarmId(null)
                      setBindUserId('')
                    }}
                  >
                    취소
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <p className="font-bold">{farm.name}</p>
                    <p className="text-xs text-muted">/farm/{farm.slug}</p>
                  <p className="text-sm mt-1">
                    {farm.bank_name} {farm.account_number}
                  </p>
                  <p className="text-sm text-muted mt-1">
                    담당 {profileLabel(profilesById.get(farm.owner_user_id))}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(farm)
                      setEditLanding(draftsFromLandingBlocks(farm.landing_blocks))
                      setBindFarmId(null)
                    }}
                  >
                    수정
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(farmLandingPath(farm.slug))
                    }}
                  >
                    랜딩페이지
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation()
                      setBindFarmId(farm.id)
                      setBindUserId(farm.owner_user_id)
                      setEditing(null)
                    }}
                  >
                    계정 연결
                  </Button>
                  <div onClick={(e) => e.stopPropagation()}>
                    <BankdaAccountLink farmId={farm.id} farmName={farm.name} />
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      setVisibilityTarget(farm)
                    }}
                  >
                    {farm.is_active ? '비활성화' : '활성화'}
                  </Button>
                </div>
              </>
            )}
          </Card>
        ))}

        {visibleFarms.length === 0 && !showCreate && (
          <p className="text-sm text-muted">
            {farms.length === 0
              ? '등록된 농가가 없습니다. 농가를 추가하고 담당 계정을 연결하세요.'
              : visibilityFilter === 'active'
                ? '활성화된 농가가 없습니다.'
                : visibilityFilter === 'inactive'
                  ? '비활성화된 농가가 없습니다.'
                  : '등록된 농가가 없습니다.'}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={!!visibilityTarget}
        title={visibilityTarget?.is_active ? '비활성화할까요?' : '활성화할까요?'}
        description={
          visibilityTarget?.is_active
            ? `${visibilityTarget.name} 주문 페이지가 손님에게 보이지 않습니다.`
            : `${visibilityTarget?.name ?? '이 농가'} 주문 페이지가 손님에게 보입니다.`
        }
        confirmLabel={visibilityTarget?.is_active ? '비활성화' : '활성화'}
        pending={visibilityPending}
        onCancel={() => {
          if (visibilityPending) return
          setVisibilityTarget(null)
        }}
        onConfirm={() => void toggleVisibility()}
      />
    </AppShell>
  )
}
