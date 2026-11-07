import { GripVertical, ImagePlus, Import, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field, Input, Select, Textarea } from '../ui/Field'
import { ErrorText } from '../ui/Feedback'
import {
  KPOST_CONTENT_CODES,
  KPOST_DELIVERY_TYPES,
  KPOST_VOLUMES,
  KPOST_WEIGHTS,
  kpostVolumeLabel,
  kpostWeightLabel,
} from '../../lib/kpostParcelExcel'
import { PriceTag, discountRate } from './PriceTag'
import { normalizeTiers } from '../../lib/shippingFee'
import { deletePublicImage, preparePublicImage, uploadFarmImage } from '../../lib/storageImages'
import { PRODUCT_IMAGE_ASPECT } from '../../lib/imageCrop'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import {
  PRODUCT_SALE_STATUS_LABEL,
  PRODUCT_SALE_STATUS_OPTIONS,
  productSaleStatus,
  type Farm,
  type Product,
  type ProductSaleStatus,
} from '../../types/models'
import { ProductCard } from './ProductCard'
import { ProductImportDialog } from './ProductImportDialog'
import { ImageCropDialog } from './ImageCropDialog'

function ImageFileInput({ onPick }: { onPick: (file: File) => void }) {
  return (
    <input
      type="file"
      accept="image/*"
      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      onChange={(e) => {
        const next = e.target.files?.[0]
        e.target.value = ''
        if (next) onPick(next)
      }}
    />
  )
}

interface ProductFormValues {
  name: string
  price: string
  /** 할인 전 원래 가격. 빈 문자열이면 할인 없음. */
  list_price: string
  /** 수량 구간별 배송비 */
  shipping_fees: { qty: number; fee: number }[]
  unit: string
  /** 저장돼 있던 원래 단위. kg 이 아니었으면 알려 주려고 들고 있는다. */
  legacyUnit?: string
  description: string
  image_url: string
  parcel_weight_kg: string
  parcel_volume_cm: string
  parcel_content_code: string
  parcel_delivery_type: string
  daily_qty_limit: string
  per_order_qty_limit: string
}

/** '5kg', '5 kg', '5' → 숫자. '박스'·'개' 등은 null. */
function kgAmountFromUnit(unit: string | null | undefined): number | null {
  const raw = unit?.trim() ?? ''
  if (!raw) return null
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*kg$/i) ?? raw.match(/^(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

/** 택배 구간과 맞는 kg 이면 그 값, 아니면 null. */
function kpostWeightFromUnit(unit: string) {
  const amount = kgAmountFromUnit(unit)
  if (amount == null) return null
  const key = Number.isInteger(amount) ? String(amount) : null
  if (!key) return null
  return KPOST_WEIGHTS.find((value) => value === key) ?? null
}

function formatUnitKg(amount: number) {
  const text = Number.isInteger(amount) ? String(amount) : String(amount)
  return `${text}kg`
}

function withCurrentOption(options: readonly string[], current: string) {
  return current && !options.includes(current) ? [current, ...options] : [...options]
}

const emptyProductForm: ProductFormValues = {
  name: '',
  price: '',
  list_price: '',
  shipping_fees: [],
  unit: '5',
  description: '',
  image_url: '',
  parcel_weight_kg: '5',
  parcel_volume_cm: '80',
  parcel_content_code: '농/수/축산물(일반)',
  parcel_delivery_type: '',
  daily_qty_limit: '100',
  per_order_qty_limit: '100',
}

function productToForm(product: Product): ProductFormValues {
  const unitKg = kgAmountFromUnit(product.unit)
  const parcel_weight_kg =
    (unitKg != null ? kpostWeightFromUnit(formatUnitKg(unitKg)) : null) ?? product.parcel_weight_kg
  return {
    name: product.name,
    price: String(product.price),
    list_price: product.list_price === null ? '' : String(product.list_price),
    shipping_fees: normalizeTiers(product.shipping_fees),
    // 박스·개 등 비-kg 값은 택배 중량으로 바꿔 kg 숫자만 쓴다.
    unit: String(unitKg ?? (Number(parcel_weight_kg) || 5)),
    // 원래 값이 kg 이 아니었으면 화면에서 알려 준다. 말없이 바꿔 저장하면
    // '25개' 로 팔던 상품이 어느 순간 5kg 이 돼 있다.
    legacyUnit: unitKg == null ? product.unit?.trim() || undefined : undefined,
    description: product.description ?? '',
    image_url: product.image_url ?? '',
    parcel_weight_kg,
    parcel_volume_cm: product.parcel_volume_cm,
    parcel_content_code: product.parcel_content_code,
    parcel_delivery_type: product.parcel_delivery_type,
    daily_qty_limit: String(product.daily_qty_limit ?? 100),
    per_order_qty_limit: String(product.per_order_qty_limit ?? 100),
  }
}

function formPayload(form: ProductFormValues) {
  const unitKg = kgAmountFromUnit(form.unit)
  if (unitKg == null) throw new Error('단위(kg)를 숫자로 입력하세요.')
  return {
    name: form.name.trim(),
    price: Number(form.price),
    // 비워 두면 할인 없음. 0 을 넣어도 할인으로 치지 않는다(표시 조건이 price 초과).
    list_price: form.list_price.trim() === '' ? null : Number(form.list_price),
    shipping_fees: normalizeTiers(form.shipping_fees),
    unit: formatUnitKg(unitKg),
    description: form.description.trim() || null,
    parcel_weight_kg: form.parcel_weight_kg,
    parcel_volume_cm: form.parcel_volume_cm,
    parcel_content_code: form.parcel_content_code,
    parcel_delivery_type: form.parcel_delivery_type,
    daily_qty_limit: Math.max(1, Number(form.daily_qty_limit) || 100),
    per_order_qty_limit: Math.max(1, Number(form.per_order_qty_limit) || 100),
  }
}

interface ProductFormCardProps {
  form: ProductFormValues
  editingId: string | null
  error: string
  showCancel: boolean
  saving: boolean
  imagePreview: string | null
  onChange: <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => void
  onPickImage: (file: File) => void
  onClearImage: () => void
  onSave: () => void
  onCancel: () => void
}

function ProductFormCard({
  form,
  editingId,
  error,
  showCancel,
  saving,
  imagePreview,
  onChange,
  onPickImage,
  onClearImage,
  onSave,
  onCancel,
}: ProductFormCardProps) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{editingId ? '상품 수정' : '상품 추가'}</h3>
        {showCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted hover:bg-gray-100"
            aria-label="닫기"
          >
            닫기
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Input label="상품명" value={form.name} onChange={(e) => onChange('name', e.target.value)} />
      <Input
        label="판매 가격"
        type="number"
        value={form.price}
        onChange={(e) => onChange('price', e.target.value)}
      />
      <div>
        <Input
          label="원래 가격 (선택)"
          type="number"
          value={form.list_price}
          onChange={(e) => onChange('list_price', e.target.value)}
          placeholder="할인 전 가격"
        />
        <p className="mt-1 text-xs text-muted">
          {discountRate(Number(form.price), Number(form.list_price) || null) !== null
            ? `${discountRate(Number(form.price), Number(form.list_price) || null)}% 할인으로 표시됩니다.`
            : form.list_price.trim() !== ''
              ? '원래 가격이 판매 가격보다 커야 할인으로 표시됩니다.'
              : '비워 두면 할인 표시가 없습니다.'}
        </p>
      </div>
      <div>
        <Input
          label="단위 (kg)"
          type="number"
          min={0.1}
          step="any"
          value={form.unit}
          onChange={(e) => {
            const next = e.target.value
            onChange('unit', next)
            const kpost = kpostWeightFromUnit(next)
            if (kpost) onChange('parcel_weight_kg', kpost)
          }}
          placeholder="예: 5"
        />
        {form.legacyUnit ? (
          <p className="mt-1 text-xs text-amber-700">
            원래 단위는 &quot;{form.legacyUnit}&quot; 였습니다. 저장하면 위의 kg 값으로 바뀝니다.
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">
            kg 숫자만 입력합니다. &quot;박스&quot;·&quot;개&quot; 같은 값은 저장되지 않습니다.
          </p>
        )}
      </div>
      <Textarea label="설명" value={form.description} onChange={(e) => onChange('description', e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="일일 주문 한도"
          type="number"
          min={1}
          value={form.daily_qty_limit}
          onChange={(e) => onChange('daily_qty_limit', e.target.value)}
        />
        <Input
          label="1회 주문 한도"
          type="number"
          min={1}
          value={form.per_order_qty_limit}
          onChange={(e) => onChange('per_order_qty_limit', e.target.value)}
        />
      </div>
      <p className="text-xs text-muted">
        한도를 넘어도 주문은 받습니다. 매장에서 예상 배송일정이 빨간색으로 바뀌고 안내 문구가 뜹니다.
      </p>
      <div>
        <span className="text-xs font-medium text-muted">이미지</span>
        {imagePreview ? (
          <div className="relative mt-1 overflow-hidden rounded-xl border border-gray-200">
            <img src={imagePreview} alt="" className="aspect-[16/9] w-full object-cover" />
            <div className="absolute right-2 top-2 flex gap-1">
              <span className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-white/95 px-3 text-xs font-medium text-gray-700 shadow-sm">
                변경
                <ImageFileInput onPick={onPickImage} />
              </span>
              <button
                type="button"
                onClick={onClearImage}
                className="inline-flex min-h-11 items-center rounded-lg bg-white/95 px-3 text-xs font-medium text-gray-700 shadow-sm"
              >
                삭제
              </button>
            </div>
          </div>
        ) : (
          <div className="relative mt-1 flex aspect-[16/9] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-gray-50 text-sm text-muted">
            <ImagePlus className="h-6 w-6" />
            앨범 또는 카메라에서 선택
            <span className="text-xs">매장 카드와 같은 비율(16:9)로 자릅니다 · 최대 5MB</span>
            <ImageFileInput onPick={onPickImage} />
          </div>
        )}
      </div>
      {/*
        고르는 값이 우체국 요금 구간의 상한이라, 얼마가 나오는지 옆에 두지
        않으면 무엇을 골라야 할지 알 수 없다. 요청받은 표를 그대로 둔다.
      */}
      <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-muted">
        <p className="font-medium text-gray-700">우체국 요금 참고</p>
        {/*
          구간별 요금표. 어떤 중량·부피를 고르면 얼마인지 숫자만 봐서는 알 수
          없어서 요청받은 표를 그대로 둔다. 폭은 위 이미지 영역과 같게 폼 전체를
          쓰고, 비율은 그대로 둔다. 560px 보다 좁아지면 글씨가 뭉개지므로 그때만
          옆으로 넘겨 본다.
        */}
        <div className="mt-1.5 overflow-x-auto">
          <img
            src="/reference/kpost-fee-table.png"
            alt="우체국 등기소포 요금표 — 부피 80cm 이하부터 160cm, 중량 3kg 이하부터 30kg 구간별 요금"
            className="h-auto w-full min-w-[560px] rounded-lg border border-gray-200 bg-white"
            loading="lazy"
          />
        </div>
        <p className="mt-1.5">
          포도 · 3kg/100 4,500원 · 7kg/100 5,000원 · 15kg/120 7,000원 · 20kg/120 11,000원
        </p>
        <p>즙 · 1box 5,000원 · 2box 7,000원 · 3box 8,000원</p>
      </div>
      <Field label="수량별 배송비">
        <div className="mt-1 space-y-1.5">
          {form.shipping_fees.map((tier, index) => (
            <div key={index} className="flex items-center gap-2 text-sm">
              <input
                type="number"
                min={1}
                value={tier.qty}
                onChange={(e) => onChange('shipping_fees', form.shipping_fees.map((t, i) =>
                  i === index ? { ...t, qty: Number(e.target.value) } : t))}
                className="w-16 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-muted">개까지</span>
              <input
                type="number"
                min={0}
                step={100}
                value={tier.fee}
                onChange={(e) => onChange('shipping_fees', form.shipping_fees.map((t, i) =>
                  i === index ? { ...t, fee: Number(e.target.value) } : t))}
                className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-muted">원</span>
              <button
                type="button"
                onClick={() => onChange('shipping_fees', form.shipping_fees.filter((_, i) => i !== index))}
                className="ml-auto text-xs text-muted hover:text-red-600"
              >
                삭제
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange('shipping_fees', [
              ...form.shipping_fees,
              { qty: (form.shipping_fees.at(-1)?.qty ?? 0) + 1, fee: 0 },
            ])}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            + 구간 추가
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {form.shipping_fees.length === 0
            ? '비워 두면 배송비를 따로 받지 않습니다 (상품가에 포함).'
            : '수량이 늘어도 배송비는 비례하지 않습니다. 마지막 구간을 넘으면 그 구간이 되풀이됩니다.'}
        </p>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="택배 중량(kg)"
          value={form.parcel_weight_kg}
          onChange={(e) => {
            const weight = e.target.value
            onChange('parcel_weight_kg', weight)
            onChange('unit', weight)
          }}
        >
          {withCurrentOption(KPOST_WEIGHTS, form.parcel_weight_kg).map((value) => (
            <option key={value} value={value}>
              {kpostWeightLabel(value)}
            </option>
          ))}
        </Select>
        <Select label="택배 부피(cm)" value={form.parcel_volume_cm} onChange={(e) => onChange('parcel_volume_cm', e.target.value)}>
          {withCurrentOption(KPOST_VOLUMES, form.parcel_volume_cm).map((value) => (
            <option key={value} value={value}>
              {kpostVolumeLabel(value)}
            </option>
          ))}
        </Select>
        <Select
          label="내용품코드"
          value={form.parcel_content_code}
          onChange={(e) => onChange('parcel_content_code', e.target.value)}
        >
          {KPOST_CONTENT_CODES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          label="배달방식"
          value={form.parcel_delivery_type}
          onChange={(e) => onChange('parcel_delivery_type', e.target.value)}
        >
          {KPOST_DELIVERY_TYPES.map((value) => (
            <option key={value || 'none'} value={value}>
              {value || '미입력'}
            </option>
          ))}
        </Select>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button onClick={onSave} disabled={saving}>
          {saving ? (editingId ? '저장 중...' : '추가 중...') : editingId ? '저장' : '추가'}
        </Button>
        {showCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            취소
          </Button>
        )}
      </div>
    </Card>
  )
}

function SaleStatusSelect({
  product,
  onChange,
}: {
  product: Product
  onChange: (status: ProductSaleStatus) => void
}) {
  return (
    <select
      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs"
      value={productSaleStatus(product)}
      onChange={(e) => onChange(e.target.value as ProductSaleStatus)}
    >
      {PRODUCT_SALE_STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/** 상품 카드에서 일일·1회 한도를 바로 고친다. */
function ProductQtyLimitsEditor({
  product,
  onSaved,
}: {
  product: Product
  onSaved: () => void
}) {
  const [daily, setDaily] = useState(String(product.daily_qty_limit ?? 100))
  const [perOrder, setPerOrder] = useState(String(product.per_order_qty_limit ?? 100))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDaily(String(product.daily_qty_limit ?? 100))
    setPerOrder(String(product.per_order_qty_limit ?? 100))
    setError('')
  }, [product.id, product.daily_qty_limit, product.per_order_qty_limit])

  async function save() {
    const dailyValue = Math.max(1, Number(daily) || 100)
    const perOrderValue = Math.max(1, Number(perOrder) || 100)
    if (
      dailyValue === (product.daily_qty_limit ?? 100) &&
      perOrderValue === (product.per_order_qty_limit ?? 100)
    ) {
      return
    }
    setSaving(true)
    setError('')
    const { error: updateError } = await supabase
      .from('products')
      .update({ daily_qty_limit: dailyValue, per_order_qty_limit: perOrderValue })
      .eq('id', product.id)
    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setDaily(String(dailyValue))
    setPerOrder(String(perOrderValue))
    onSaved()
  }

  return (
    <div className="mt-2 space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] font-medium text-muted">일일 한도</span>
          <input
            type="number"
            min={1}
            className="mt-0.5 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            value={daily}
            disabled={saving}
            onChange={(e) => setDaily(e.target.value)}
            onBlur={() => void save()}
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-muted">1회 한도</span>
          <input
            type="number"
            min={1}
            className="mt-0.5 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            value={perOrder}
            disabled={saving}
            onChange={(e) => setPerOrder(e.target.value)}
            onBlur={() => void save()}
          />
        </label>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

function moveItem<T>(list: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

interface ProductManagerProps {
  farmId: string
  variant?: 'admin' | 'farm'
  onCountChange?: (count: number) => void
}

export function ProductManager({ farmId, variant = 'admin', onCountChange }: ProductManagerProps) {
  const isFarm = variant === 'farm'
  const { isAdmin } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [form, setForm] = useState<ProductFormValues>(emptyProductForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(!isFarm)
  const [reordering, setReordering] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageRemoved, setImageRemoved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [farmDailyLimit, setFarmDailyLimit] = useState('100')
  const [farmLimitMessage, setFarmLimitMessage] = useState('')
  const [farmLimitError, setFarmLimitError] = useState('')
  const [farmLimitSaving, setFarmLimitSaving] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const productsRef = useRef(products)
  const dragIdRef = useRef<string | null>(null)
  productsRef.current = products
  const imageObjectUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile])
  const imagePreview = imageObjectUrl ?? (imageRemoved ? null : form.image_url || null)

  useEffect(() => {
    if (!imageObjectUrl) return
    return () => URL.revokeObjectURL(imageObjectUrl)
  }, [imageObjectUrl])

  const formVisible = isFarm ? formOpen : true

  async function load() {
    const { data } = await supabase.from('products').select('*').eq('farm_id', farmId).order('sort_order')
    const list = (data as Product[]) ?? []
    setProducts(list)
    onCountChange?.(list.length)
  }

  async function loadFarmLimit() {
    const { data } = await supabase.from('farms').select('daily_qty_limit').eq('id', farmId).maybeSingle()
    const farm = data as Pick<Farm, 'daily_qty_limit'> | null
    setFarmDailyLimit(String(farm?.daily_qty_limit ?? 100))
  }

  useEffect(() => {
    setForm(emptyProductForm)
    setEditingId(null)
    setError('')
    setImageFile(null)
    setImageRemoved(false)
    setSaving(false)
    setReordering(false)
    setDraggingId(null)
    setFarmLimitMessage('')
    setFarmLimitError('')
    void loadFarmLimit()
    supabase
      .from('products')
      .select('*')
      .eq('farm_id', farmId)
      .order('sort_order')
      .then(({ data }) => {
        const list = (data as Product[]) ?? []
        setProducts(list)
        onCountChange?.(list.length)
      })
  }, [farmId, onCountChange])

  async function saveFarmDailyLimit() {
    setFarmLimitError('')
    setFarmLimitMessage('')
    const value = Math.max(1, Number(farmDailyLimit) || 100)
    setFarmLimitSaving(true)
    const { error: updateError } = await supabase
      .from('farms')
      .update({ daily_qty_limit: value })
      .eq('id', farmId)
    setFarmLimitSaving(false)
    if (updateError) {
      setFarmLimitError(updateError.message)
      return
    }
    setFarmDailyLimit(String(value))
    setFarmLimitMessage('저장했습니다.')
  }

  function update<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function toggleAdd() {
    if (formOpen && !editingId) {
      closeForm()
      return
    }
    setEditingId(null)
    setForm(emptyProductForm)
    setError('')
    setImageFile(null)
    setImageRemoved(false)
    setFormOpen(true)
  }

  function closeForm() {
    setEditingId(null)
    setForm(emptyProductForm)
    setError('')
    setImageFile(null)
    setImageRemoved(false)
    if (isFarm) setFormOpen(false)
  }

  function pickImage(file: File) {
    setError('')
    setCropFile(file)
  }

  async function applyCroppedImage(cropped: File) {
    setCropFile(null)
    const prepared = await preparePublicImage(cropped)
    if (typeof prepared === 'string') {
      setError(prepared)
      return
    }
    setError('')
    setImageFile(prepared)
    setImageRemoved(false)
  }

  function clearImage() {
    setImageFile(null)
    setImageRemoved(true)
  }

  function toggleReorder() {
    if (reordering) {
      setReordering(false)
      setDraggingId(null)
      dragIdRef.current = null
      return
    }
    closeForm()
    setReordering(true)
  }

  async function persistOrder(list: Product[]) {
    const results = await Promise.all(
      list.map((product, index) =>
        supabase.from('products').update({ sort_order: index }).eq('id', product.id),
      ),
    )
    if (results.some((result) => result.error)) await load()
  }

  async function setSaleStatus(productId: string, saleStatus: ProductSaleStatus) {
    await supabase.from('products').update({ sale_status: saleStatus }).eq('id', productId)
    await load()
  }

  function onReorderPointerDown(event: PointerEvent<HTMLDivElement>, id: string) {
    if (!reordering || event.button !== 0) return
    event.preventDefault()
    dragIdRef.current = id
    setDraggingId(id)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onReorderPointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragId = dragIdRef.current
    if (!dragId) return
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-product-id]')
    const overId = over instanceof HTMLElement ? over.dataset.productId : undefined
    if (!overId || overId === dragId) return
    const current = productsRef.current
    const from = current.findIndex((product) => product.id === dragId)
    const to = current.findIndex((product) => product.id === overId)
    if (from < 0 || to < 0 || from === to) return
    const next = moveItem(current, from, to).map((product, index) => ({ ...product, sort_order: index }))
    productsRef.current = next
    setProducts(next)
  }

  function onReorderPointerUp() {
    if (!dragIdRef.current) return
    dragIdRef.current = null
    setDraggingId(null)
    void persistOrder(productsRef.current)
  }

  async function save() {
    setError('')
    let payload: ReturnType<typeof formPayload>
    try {
      payload = formPayload(form)
    } catch (err) {
      setError(err instanceof Error ? err.message : '입력을 확인하세요.')
      return
    }
    if (!payload.name || !Number.isFinite(payload.price) || payload.price < 0) {
      setError('상품명과 가격을 입력하세요.')
      return
    }
    setSaving(true)
    const previousImageUrl = form.image_url || null
    try {
      let imageUrl = imageRemoved ? null : previousImageUrl
      if (imageFile) imageUrl = await uploadFarmImage(farmId, imageFile)
      const { error: saveError } = editingId
        ? await supabase.from('products').update({ ...payload, image_url: imageUrl }).eq('id', editingId)
        : await supabase.from('products').insert({
            ...payload,
            image_url: imageUrl,
            farm_id: farmId,
            sort_order: products.reduce((max, product) => Math.max(max, product.sort_order), -1) + 1,
          })
      if (saveError) {
        setError(saveError.message)
        return
      }
      if (previousImageUrl && previousImageUrl !== imageUrl) {
        void deletePublicImage(previousImageUrl)
      }
      closeForm()
      if (!isFarm) setForm(emptyProductForm)
      await load()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '이미지 업로드에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const formCard = formVisible ? (
    <ProductFormCard
      form={form}
      editingId={editingId}
      error={error}
      showCancel={Boolean(editingId) || isFarm}
      saving={saving}
      imagePreview={imagePreview}
      onChange={update}
      onPickImage={pickImage}
      onClearImage={clearImage}
      onSave={() => void save()}
      onCancel={closeForm}
    />
  ) : null

  const cropDialog = (
    <ImageCropDialog
      open={Boolean(cropFile)}
      file={cropFile}
      aspect={PRODUCT_IMAGE_ASPECT}
      title="상품 사진 자르기"
      hint="매장·상품 카드에 보이는 16:9 비율로 맞춰 자른 뒤 확인하세요."
      onCancel={() => setCropFile(null)}
      onConfirm={(next) => void applyCroppedImage(next)}
    />
  )

  if (isFarm) {
    return (
      <div className="space-y-4">
        <Card className="space-y-3">
          <h3 className="font-semibold">농가 일일 주문 한도 (전체)</h3>
          <p className="text-xs text-muted">
            오늘 이 농가에 들어온 <span className="font-medium text-gray-700">전체 수량</span>
            기준입니다. 상품별 일일·1회 한도는 아래 각 상품 카드에서 따로 조정합니다. 넘어도
            주문은 받으며 매장에서 경고만 표시합니다.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[8rem] flex-1">
              <Input
                label="일일 전체 한도"
                type="number"
                min={1}
                value={farmDailyLimit}
                onChange={(e) => setFarmDailyLimit(e.target.value)}
              />
            </div>
            <Button disabled={farmLimitSaving} onClick={() => void saveFarmDailyLimit()}>
              {farmLimitSaving ? '저장 중...' : '저장'}
            </Button>
          </div>
          <ErrorText>{farmLimitError}</ErrorText>
          {farmLimitMessage ? <p className="text-sm text-primary">{farmLimitMessage}</p> : null}
        </Card>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button onClick={toggleAdd} disabled={reordering}>
              <Plus className="h-4 w-4" />
              새 상품 추가
            </Button>
            {/*
              불러오기는 남의 농가 상품까지 훑는다. 농가 사람에게는 보이면
              안 되므로 실제 권한(role=admin)으로 가른다. 농가 작업공간을
              관리자가 열었을 때는 그대로 쓸 수 있어야 해서 variant 로는
              가르지 않는다.
            */}
            {isAdmin && (
              <Button type="button" variant="outline" disabled={reordering} onClick={() => setImportOpen(true)}>
                <Import className="h-4 w-4" />
                불러오기
              </Button>
            )}
          </div>
          {products.length > 1 && (
            <Button variant={reordering ? 'primary' : 'outline'} onClick={toggleReorder}>
              {reordering ? '완료' : '순서 변경'}
            </Button>
          )}
        </div>
        {reordering && (
          <p className="text-sm text-muted">카드를 드래그해서 순서를 바꾸세요. 주문 페이지에도 같은 순서로 보입니다.</p>
        )}
        {!reordering && !editingId && formCard}
        {products.length === 0 ? (
          <p className="text-center text-muted py-10">등록된 상품이 없습니다</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {products.map((product) => {
              if (!reordering && editingId === product.id) {
                return (
                  <div key={product.id} className="sm:col-span-2">
                    {formCard}
                  </div>
                )
              }
              return (
                <div
                  key={product.id}
                  data-product-id={product.id}
                  className={`relative h-full ${reordering ? 'cursor-grab touch-none select-none' : ''} ${
                    draggingId === product.id ? 'opacity-60 ring-2 ring-primary rounded-2xl' : ''
                  }`}
                  style={reordering ? { touchAction: 'none' } : undefined}
                  onPointerDown={(event) => onReorderPointerDown(event, product.id)}
                  onPointerMove={onReorderPointerMove}
                  onPointerUp={onReorderPointerUp}
                  onPointerCancel={onReorderPointerUp}
                >
                  {reordering && (
                    <div className="pointer-events-none absolute right-2 top-2 z-10 rounded-lg bg-white/90 p-1 shadow-sm">
                      <GripVertical className="h-4 w-4 text-muted" />
                    </div>
                  )}
                  <ProductCard
                    product={product}
                    extra={
                      reordering ? undefined : (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <SaleStatusSelect
                              product={product}
                              onChange={(status) => void setSaleStatus(product.id, status)}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingId(product.id)
                                setForm(productToForm(product))
                                setImageFile(null)
                                setImageRemoved(false)
                                setError('')
                                setFormOpen(true)
                              }}
                            >
                              수정
                            </Button>
                          </div>
                          <ProductQtyLimitsEditor product={product} onSaved={() => void load()} />
                        </div>
                      )
                    }
                  />
                </div>
              )
            })}
          </div>
        )}
        <ProductImportDialog
          open={importOpen}
          onClose={() => setImportOpen(false)}
          targetFarmId={farmId}
          nextSortOrder={products.reduce((max, product) => Math.max(max, product.sort_order), -1) + 1}
          onImported={() => void load()}
        />
        {cropDialog}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {formCard}
      {products.map((product) => (
        <Card key={product.id} className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">
              {product.name} {product.unit}
            </p>
            <p className="text-sm text-primary">
              <PriceTag price={product.price} listPrice={product.list_price} />
            </p>
            <p className="text-xs text-muted">
              {PRODUCT_SALE_STATUS_LABEL[productSaleStatus(product)]} · 택배 {kpostWeightLabel(product.parcel_weight_kg)} · {kpostVolumeLabel(product.parcel_volume_cm)}
              · {product.parcel_content_code}
              {product.parcel_delivery_type ? ` · ${product.parcel_delivery_type}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <SaleStatusSelect
              product={product}
              onChange={(status) => void setSaleStatus(product.id, status)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingId(product.id)
                setForm(productToForm(product))
                setImageFile(null)
                setImageRemoved(false)
                setError('')
              }}
            >
              수정
            </Button>
          </div>
        </Card>
      ))}
      {cropDialog}
    </div>
  )
}
