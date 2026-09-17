import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { ShippingScheduleNotice } from '../../components/shared/ShippingScheduleNotice'
import { Header } from '../../components/layout/Header'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { AddressPicker } from '../../components/shared/AddressPicker'
import { Input } from '../../components/ui/Field'
import { PhoneField } from '../../components/ui/PhoneField'
import { RequestMemoField } from '../../components/ui/RequestMemoField'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { ErrorText, PageSpinner } from '../../components/ui/Feedback'
import { shippingFeeFor } from '../../lib/shippingFee'
import { clearCart, getCart } from '../../lib/cart'
import {
  createDevBypassCheckoutFarm,
  createDevBypassProducts,
  ensureDevBypassCart,
  isDevAuthBypass,
} from '../../lib/devAuthBypass'
import { formatPrice } from '../../lib/format'
import { invokeFunction } from '../../lib/functions'
import {
  emptyTodayQty,
  isQtyVolumeExceeded,
  QTY_VOLUME_WARNING,
  type TodayQty,
} from '../../lib/qtyLimits'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { isProductOrderable, type Farm, type Product, type SavedAddress } from '../../types/models'

interface CheckoutResult {
  orderId: string
}

export function Checkout() {
  const { farmSlug = '' } = useParams()
  const navigate = useNavigate()
  const { user, profile, refresh } = useAuth()
  const [farm, setFarm] = useState<Farm | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string | 'new'>('new')
  const [saveAddress, setSaveAddress] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [todayQty, setTodayQty] = useState<TodayQty>(emptyTodayQty())
  const [volumeDialogOpen, setVolumeDialogOpen] = useState(false)
  /** 손님이 고른 출고일. null 이면 가장 빠른 날. */
  const [chosenShipDate, setChosenShipDate] = useState<string | null>(null)
  const [form, setForm] = useState({
    recipient_name: '',
    phone: '',
    zonecode: '',
    address: '',
    address_detail: '',
    request_memo: '',
  })
  const [senderUi, setSenderUi] = useState({
    depositorName: '',
    phone: '',
    name: '',
    senderPhone: '',
    zonecode: '',
    address: '',
    addressDetail: '',
  })
  const [sameAsDepositorUi, setSameAsDepositorUi] = useState(false)
  const [senderOpenUi, setSenderOpenUi] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)

  const profileDiffers = useMemo(() => {
    if (!profile) return false
    const pName = profile.display_name?.trim() ?? ''
    const pPhone = profile.phone?.trim() ?? ''
    const curName = senderUi.depositorName.trim()
    const curPhone = senderUi.phone.trim()
    if (!curName && !curPhone) return false
    return curName !== pName || curPhone !== pPhone
  }, [profile, senderUi.depositorName, senderUi.phone])

  async function saveProfileAsDefault() {
    if (!user || savingProfile) return
    setSavingProfile(true)
    try {
      await supabase
        .from('profiles')
        .update({
          display_name: senderUi.depositorName.trim(),
          phone: senderUi.phone.trim(),
        })
        .eq('id', user.id)
      await refresh()
    } finally {
      setSavingProfile(false)
    }
  }

  const cart = getCart(farmSlug)
  const qtyById = useMemo(
    () => Object.fromEntries(cart.map((item) => [item.productId, item.quantity])),
    [cart],
  )

  useEffect(() => {
    async function load() {
      if (isDevAuthBypass()) {
        const farmData = createDevBypassCheckoutFarm(farmSlug)
        const productRows = createDevBypassProducts(farmData.id)
        ensureDevBypassCart(farmSlug, productRows)
        setFarm(farmData)
        setProducts(productRows)
        setTodayQty(emptyTodayQty())
        setLoading(false)
        return
      }

      const { data: farmRow } = await supabase.from('farms').select('*').eq('slug', farmSlug).maybeSingle()
      const farmData = farmRow as Farm | null
      setFarm(farmData)
      if (farmData) {
        const [{ data: productRows }, qty] = await Promise.all([
          supabase
            .from('products')
            .select('*')
            .eq('farm_id', farmData.id)
            .eq('sale_status', 'on_sale'),
          invokeFunction<TodayQty>('farm-today-qty', { farmId: farmData.id }).catch(() => emptyTodayQty()),
        ])
        setProducts((productRows as Product[]) ?? [])
        setTodayQty(qty)
      }
      if (user) {
        const { data: addrRows } = await supabase
          .from('saved_addresses')
          .select('*')
          .eq('user_id', user.id)
          .order('is_default', { ascending: false })
          .order('last_used_at', { ascending: false })
        const list = uniqueSavedAddresses((addrRows as SavedAddress[]) ?? [])
        setAddresses(list)
        const def = list.find((a) => a.is_default) ?? list[0]
        if (def) applyAddress(def)
      }
      setLoading(false)
    }
    void load()
  }, [farmSlug, user])

  function applyAddress(addr: SavedAddress) {
    setSelectedAddressId(addr.id)
    setForm((prev) => ({
      ...prev,
      recipient_name: addr.recipient_name,
      phone: addr.phone,
      zonecode: addr.zonecode ?? '',
      address: addr.address,
      address_detail: addr.address_detail ?? '',
    }))
  }

  useEffect(() => {
    if (!profile) return
    const profileName = profile.display_name?.trim() ?? ''
    const profilePhone = profile.phone?.trim() ?? ''

    if (profileName || profilePhone) {
      setForm((prev) => ({
        ...prev,
        recipient_name: prev.recipient_name.trim() ? prev.recipient_name : profileName,
        phone: prev.phone.trim() ? prev.phone : profilePhone,
      }))
    }

    setSenderUi((prev) => ({
      ...prev,
      depositorName: prev.depositorName.trim() ? prev.depositorName : profileName,
      phone: prev.phone.trim() ? prev.phone : profilePhone,
      name: prev.name.trim() ? prev.name : profileName,
      senderPhone: prev.senderPhone.trim() ? prev.senderPhone : profilePhone,
    }))
  }, [profile])

  const lines = products
    .filter((product) => isProductOrderable(product) && (qtyById[product.id] ?? 0) > 0)
    .map((product) => ({
      product,
      quantity: qtyById[product.id] ?? 0,
    }))
  const goodsTotal = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0)
  // 배송비는 수량에 비례하지 않는다. 서버가 다시 계산하지만 손님이 주문 전에
  // 얼마인지 알아야 하므로 화면에서도 같은 규칙으로 센다.
  const shippingTotal = lines.reduce(
    (sum, line) => sum + shippingFeeFor(line.product.shipping_fees, line.quantity), 0)
  const total = goodsTotal + shippingTotal
  const volumeWarning = Boolean(
    farm &&
      isQtyVolumeExceeded({
        farm,
        products,
        cart,
        today: todayQty,
      }),
  )

  async function placeOrder() {
    setError('')
    if (!form.address.trim()) {
      setError('배송지를 현재 위치 또는 검색으로 설정해 주세요.')
      return
    }
    if (!farm) return
    if (isDevAuthBypass()) {
      setError('로컬 데모 모드에서는 주문을 전송하지 않습니다.')
      return
    }
    setPending(true)
    try {
      const result = await invokeFunction<CheckoutResult>('create-order', {
        farmId: farm.id,
        sender: {
          depositorName: senderUi.depositorName,
          name: senderUi.name,
          phone: senderUi.phone,
          zonecode: senderUi.zonecode,
          address: senderUi.address,
          addressDetail: senderUi.addressDetail,
        },
        items: lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        recipient: {
          name: form.recipient_name,
          phone: form.phone,
          zonecode: form.zonecode,
          address: form.address,
          addressDetail: form.address_detail,
        },
        requestMemo: form.request_memo,
        // 고르지 않았으면 보내지 않는다. 서버가 가장 이른 출고일로 둔다.
        requestedShipDate: chosenShipDate,
        saveAddress: alreadySavedAddress(addresses, form) ? false : selectedAddressId === 'new' && saveAddress,
      })
      clearCart(farmSlug)
      await refresh()
      navigate(`/me/orders/${result.orderId}/complete`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '주문에 실패했습니다.')
      setPending(false)
    }
  }

  if (loading) return <PageSpinner />
  if (pending) return <PageSpinner label="주문을 처리하는 중..." />
  if (!farm) {
    return <div className="min-h-dvh flex items-center justify-center text-muted">농가를 찾을 수 없습니다</div>
  }
  if (lines.length === 0) {
    return (
      <div className="min-h-dvh bg-surface">
        <Header title="주문하기" showBack backTo={`/farm/${farmSlug}`} />
        <div className="px-4 py-10 text-center text-muted">
          담긴 상품이 없습니다.{' '}
          <Link className="text-primary font-semibold" to={`/farm/${farmSlug}`}>
            상품 선택하기
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-surface pb-10">
      <Header title="주문하기" showBack backTo={`/farm/${farmSlug}`} />
      <form
        className="px-4 py-4 md:px-6 max-w-lg mx-auto space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (volumeWarning) {
            setVolumeDialogOpen(true)
            return
          }
          void placeOrder()
        }}
      >
        <Card>
          <h3 className="font-semibold mb-3">주문 상품 · {farm.name}</h3>
          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.product.id} className="flex justify-between text-sm">
                <span>
                  {line.product.name} {line.product.unit} ×{line.quantity}
                </span>
                <span className="font-medium">{formatPrice(line.product.price * line.quantity)}</span>
              </div>
            ))}
          </div>
          {shippingTotal > 0 && (
            <div className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm">
              <div className="flex justify-between text-muted">
                <span>상품 금액</span>
                <span>{formatPrice(goodsTotal)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>배송비</span>
                <span>{formatPrice(shippingTotal)}</span>
              </div>
            </div>
          )}
          <div className={`flex justify-between font-bold ${shippingTotal > 0 ? 'mt-2' : 'mt-3'}`}>
            <span>합계</span>
            <span className="text-primary">{formatPrice(total)}</span>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">입금자</h3>
            {profileDiffers && (
              <button
                type="button"
                disabled={savingProfile}
                onClick={saveProfileAsDefault}
                className="rounded-lg border border-primary px-2.5 py-1 text-xs font-medium text-primary disabled:opacity-50"
              >
                {savingProfile ? '저장 중…' : '기본으로 저장'}
              </button>
            )}
          </div>
          <p className="text-xs text-muted">입금 확인에 사용됩니다. 입금자명과 입금자 연락처는 필수입니다.</p>
          <Input
            form=""
            label="입금자명"
            placeholder="통장에 표시될 이름"
            autoComplete="off"
            value={senderUi.depositorName}
            onChange={(e) => setSenderUi((p) => ({ ...p, depositorName: e.target.value }))}
          />
          <PhoneField
            label="입금자 연락처"
            value={senderUi.phone}
            onChange={(phone) => setSenderUi((p) => ({ ...p, phone }))}
          />
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSenderOpenUi((v) => !v)}
              aria-expanded={senderOpenUi}
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
            >
              <h3 className="font-semibold">보내는 분 (선택)</h3>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted transition-transform ${senderOpenUi ? 'rotate-180' : ''}`}
              />
            </button>
            <button
              type="button"
              onClick={() => setSameAsDepositorUi((v) => !v)}
              className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs font-medium ${
                sameAsDepositorUi ? 'border-primary bg-primary-light text-primary' : 'border-gray-200 text-muted'
              }`}
            >
              입금자와 동일
            </button>
          </div>
          {senderOpenUi && (
            <>
              <Input
                form=""
                label="보내는 분 (선택)"
                placeholder="보내는 분 이름"
                autoComplete="off"
                value={senderUi.name}
                onChange={(e) => setSenderUi((p) => ({ ...p, name: e.target.value }))}
              />
              <PhoneField
                label="연락처 (선택)"
                value={senderUi.senderPhone}
                onChange={(senderPhone) => setSenderUi((p) => ({ ...p, senderPhone }))}
              />
              {/*
                버튼만 있고 아무 동작도 붙어 있지 않았다. 그래서 보내는 분
                주소는 저장된 적이 없고 상세주소만 sender_address 로 들어갔다.
                배송지와 같은 선택기를 그대로 쓴다.
              */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted">주소 (선택)</p>
                <AddressPicker
                  value={{
                    zonecode: senderUi.zonecode,
                    address: senderUi.address,
                    addressDetail: senderUi.addressDetail,
                  }}
                  searchTitle="보내는 분 주소 검색"
                  emptyHint="보내는 분 주소를 현재 위치 또는 검색으로 설정해 주세요"
                  detailLabel="상세주소 (선택)"
                  onChange={(next) =>
                    setSenderUi((p) => ({
                      ...p,
                      zonecode: next.zonecode,
                      address: next.address,
                      addressDetail: next.addressDetail,
                    }))
                  }
                />
              </div>
            </>
          )}
        </Card>

        <Card className="space-y-3">
          <h3 className="font-semibold">배송지</h3>
          {addresses.length > 0 && (
            <div className="space-y-2">
              {addresses.map((addr) => (
                <button
                  type="button"
                  key={addr.id}
                  onClick={() => applyAddress(addr)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                    selectedAddressId === addr.id ? 'border-primary bg-primary-light' : 'border-gray-200'
                  }`}
                >
                  <p className="font-medium">
                    {addr.recipient_name} · {addr.phone}
                    {addr.is_default ? ' (기본)' : ''}
                  </p>
                  <p className="text-muted">
                    {addr.address} {addr.address_detail}
                  </p>
                </button>
              ))}
              <button
                type="button"
                className="text-sm text-primary font-medium"
                onClick={() => {
                  setSelectedAddressId('new')
                  setForm((prev) => ({
                    ...prev,
                    recipient_name: profile?.display_name ?? '',
                    phone: profile?.phone ?? '',
                    zonecode: '',
                    address: '',
                    address_detail: '',
                  }))
                }}
              >
                새 주소 입력
              </button>
            </div>
          )}
          <Input
            label="받는 분"
            value={form.recipient_name}
            onChange={(e) => setForm((p) => ({ ...p, recipient_name: e.target.value }))}
            required
          />
          <PhoneField
            label="전화번호"
            value={form.phone}
            onChange={(phone) => setForm((p) => ({ ...p, phone }))}
            required
          />
          <AddressPicker
            value={{
              zonecode: form.zonecode,
              address: form.address,
              addressDetail: form.address_detail,
            }}
            detailLabel="상세주소 (선택)"
            onChange={(next) => {
              if (next.address !== form.address || next.zonecode !== form.zonecode) {
                setSelectedAddressId('new')
              }
              setForm((p) => ({
                ...p,
                zonecode: next.zonecode,
                address: next.address,
                address_detail: next.addressDetail,
              }))
            }}
          />
          <RequestMemoField
            label="요청사항 (선택)"
            value={form.request_memo}
            onChange={(request_memo) => setForm((p) => ({ ...p, request_memo }))}
          />
          {selectedAddressId === 'new' && !alreadySavedAddress(addresses, form) && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveAddress}
                onChange={(e) => setSaveAddress(e.target.checked)}
                className="rounded accent-primary"
              />
              이 주소를 계정에 저장하고 다음에 사용
            </label>
          )}
        </Card>

          <ShippingScheduleNotice
            days={farm.delivery_days}
            farmId={farm.id}
            volumeWarning={volumeWarning}
            volumeWarningMessage={QTY_VOLUME_WARNING}
            chosenShipDate={chosenShipDate}
            onChangeShipDate={setChosenShipDate}
          />

        <Card className="bg-primary-light border-primary/20">
          <p className="text-sm text-gray-800">
            주문이 완료되면 입금할 농가 계좌를 안내해 드립니다. 입금 확인 후 출고가 진행됩니다.
          </p>
        </Card>

        <ErrorText>{error}</ErrorText>
        <Button type="submit" fullWidth size="lg" disabled={pending || !farm?.is_active}>
          {!farm?.is_active ? '지금은 주문을 받지 않습니다' : `${formatPrice(total)} 주문하기`}
        </Button>
      </form>
      <ConfirmDialog
        open={volumeDialogOpen}
        title="배송 일정 확인"
        description={QTY_VOLUME_WARNING}
        confirmLabel="확인하고 주문하기"
        pending={pending}
        onCancel={() => setVolumeDialogOpen(false)}
        onConfirm={() => {
          setVolumeDialogOpen(false)
          void placeOrder()
        }}
      />
    </div>
  )
}

function normalizeAddressPart(value?: string | null) {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

function addressKey(address: string, detail?: string | null, zonecode?: string | null) {
  return `${normalizeAddressPart(address)}|${normalizeAddressPart(detail)}|${normalizeAddressPart(zonecode)}`
}

function alreadySavedAddress(
  list: SavedAddress[],
  form: { address: string; address_detail: string; zonecode: string },
) {
  const key = addressKey(form.address, form.address_detail, form.zonecode)
  return list.some((addr) => addressKey(addr.address, addr.address_detail, addr.zonecode) === key)
}

function uniqueSavedAddresses(list: SavedAddress[]) {
  const seen = new Map<string, SavedAddress>()
  for (const addr of list) {
    const key = addressKey(addr.address, addr.address_detail, addr.zonecode)
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, addr)
      continue
    }
    const addrUsed = addr.last_used_at ?? addr.created_at
    const prevUsed = prev.last_used_at ?? prev.created_at
    if (addr.is_default && !prev.is_default) seen.set(key, addr)
    else if (addr.is_default === prev.is_default && addrUsed > prevUsed) seen.set(key, addr)
  }
  return [...seen.values()]
}
