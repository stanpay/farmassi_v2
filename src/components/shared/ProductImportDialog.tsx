import { Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { productGradient } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import {
  PRODUCT_SALE_STATUS_LABEL,
  productSaleStatus,
  type Product,
  type ProductSaleStatus,
} from '../../types/models'
import { Button } from '../ui/Button'
import { ErrorText } from '../ui/Feedback'
import { FarmFilterChips } from './FarmFilterChips'
import { PriceTag } from './PriceTag'
import { normalizeTiers } from '../../lib/shippingFee'

type ImportProductRow = Product & {
  farms: { name: string } | null
}

interface ProductImportDialogProps {
  open: boolean
  onClose: () => void
  targetFarmId: string
  nextSortOrder: number
  onImported: () => void
}

function copyPayload(source: ImportProductRow) {
  const unitKg = (() => {
    const raw = source.unit?.trim() ?? ''
    const match = raw.match(/^(\d+(?:\.\d+)?)\s*kg$/i) ?? raw.match(/^(\d+(?:\.\d+)?)$/)
    if (match) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value > 0) {
        return Number.isInteger(value) ? `${value}kg` : `${value}kg`
      }
    }
    const parcel = Number(source.parcel_weight_kg)
    return Number.isFinite(parcel) && parcel > 0 ? `${parcel}kg` : '5kg'
  })()
  return {
    name: source.name,
    price: source.price,
    list_price: source.list_price,
    unit: unitKg,
    description: source.description,
    image_url: source.image_url,
    parcel_weight_kg: source.parcel_weight_kg,
    parcel_volume_cm: source.parcel_volume_cm,
    parcel_content_code: source.parcel_content_code,
    parcel_delivery_type: source.parcel_delivery_type,
    daily_qty_limit: source.daily_qty_limit ?? 100,
    per_order_qty_limit: source.per_order_qty_limit ?? 100,
    // 구간표를 빠뜨리면 복사본이 배송비 0원으로 팔린다. 값 채로 베낀다.
    shipping_fees: normalizeTiers(source.shipping_fees),
    sale_status: 'hidden' as ProductSaleStatus,
  }
}

export function ProductImportDialog({
  open,
  onClose,
  targetFarmId,
  nextSortOrder,
  onImported,
}: ProductImportDialogProps) {
  const [farmId, setFarmId] = useState<string | 'all'>('all')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ImportProductRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [importingId, setImportingId] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState(nextSortOrder)

  useEffect(() => {
    setSortOrder(nextSortOrder)
  }, [nextSortOrder, open])

  useEffect(() => {
    if (!open) return
    setFarmId('all')
    setQuery('')
    setError('')
    setLoading(true)
    void supabase
      .from('products')
      .select('*, farms(name)')
      .order('name')
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setError(loadError.message)
          setRows([])
        } else {
          setRows((data as ImportProductRow[]) ?? [])
        }
        setLoading(false)
      })
  }, [open])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  const farms = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>()
    for (const row of rows) {
      const id = row.farm_id
      const name = row.farms?.name ?? '농가'
      const current = counts.get(id)
      if (current) current.count += 1
      else counts.set(id, { id, name, count: 1 })
    }
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [rows])

  const visible = useMemo(() => {
    const farmFiltered = farmId === 'all' ? rows : rows.filter((row) => row.farm_id === farmId)
    const q = query.trim().toLowerCase()
    if (!q) return farmFiltered
    return farmFiltered.filter((row) => {
      const farmName = row.farms?.name ?? ''
      return `${row.name} ${farmName} ${row.unit ?? ''}`.toLowerCase().includes(q)
    })
  }, [farmId, query, rows])

  async function importProduct(source: ImportProductRow) {
    setError('')
    setImportingId(source.id)
    const order = sortOrder
    try {
      const { error: insertError } = await supabase.from('products').insert({
        ...copyPayload(source),
        farm_id: targetFarmId,
        sort_order: order,
      })
      if (insertError) {
        setError(insertError.message)
        return
      }
      setSortOrder(order + 1)
      onImported()
      onClose()
    } finally {
      setImportingId(null)
    }
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center md:p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="닫기" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-import-title"
        className="animate-sheet-up relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.12)] md:rounded-2xl md:shadow-lg"
      >
        <div className="shrink-0 border-b border-gray-100 px-4 pb-3 pt-3 md:pt-4">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 md:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="product-import-title" className="text-lg font-bold">
                다른 매장에서 불러오기
              </h2>
              <p className="mt-1 text-sm text-muted">
                선택한 상품은 복사본으로 추가됩니다. 기존 상품은 바뀌지 않습니다. 복사본은 숨김 상태로
                추가됩니다.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-gray-100"
              aria-label="닫기"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="상품명 검색"
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="mt-3">
            <FarmFilterChips farms={farms} selectedId={farmId} onSelect={setFarmId} allCount={rows.length} />
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="py-16 text-center text-sm text-muted">불러오는 중...</p>
          ) : visible.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted">검색 결과가 없습니다</p>
          ) : (
            <ul className="space-y-2">
              {visible.map((product) => {
                const status = productSaleStatus(product)
                const farmName = product.farms?.name ?? '농가'
                return (
                  <li key={product.id} className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-2.5">
                    <div className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br ${productGradient(product.id)}`}>
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-gray-900">{product.name}</p>
                      <p className="truncate text-xs text-muted">
                        {farmName} · {product.unit ?? '단위 없음'}
                        {status !== 'on_sale' ? ` · ${PRODUCT_SALE_STATUS_LABEL[status]}` : ''}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold text-primary">
                        <PriceTag price={product.price} listPrice={product.list_price} showRate={false} />
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={importingId !== null}
                      onClick={() => void importProduct(product)}
                    >
                      {importingId === product.id ? '복사 중...' : '불러오기'}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
