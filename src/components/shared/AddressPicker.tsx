import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LocateFixed, MapPin, Search, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { ErrorText } from '../ui/Feedback'
import {
  createAddressMap,
  enrichZonecode,
  getCurrentAddress,
  loadKakaoMaps,
  searchAddresses,
  type AddressCandidate,
} from '../../lib/naverMap'

export interface AddressValue {
  zonecode: string
  address: string
  addressDetail: string
}

interface AddressPickerProps {
  value: AddressValue
  onChange: (value: AddressValue) => void
  emptyHint?: string
  searchTitle?: string
  detailPlaceholder?: string
  detailLabel?: string
}

type OverlayView = 'search' | 'confirm'

export function AddressPicker({
  value,
  onChange,
  emptyHint = '배송지를 현재 위치 또는 검색으로 설정해 주세요',
  searchTitle = '배송지 검색',
  detailPlaceholder = '동·호수, 공동현관 비밀번호 등',
  detailLabel = '상세주소',
}: AddressPickerProps) {
  const searchId = useId()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<OverlayView>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AddressCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<AddressCandidate | null>(null)
  const mapElRef = useRef<HTMLDivElement>(null)
  const mapCleanupRef = useRef<(() => void) | null>(null)
  const previewRef = useRef<AddressCandidate | null>(null)
  previewRef.current = preview

  function tearDownMap() {
    const cleanup = mapCleanupRef.current
    mapCleanupRef.current = null
    if (!cleanup) return
    try {
      cleanup()
    } catch {
      /* map SDK can throw while detaching from a closing portal */
    }
  }

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    if (!open || view !== 'search') return
    const keyword = query.trim()
    if (keyword.length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    const timer = window.setTimeout(() => {
      setSearching(true)
      setError('')
      void searchAddresses(keyword)
        .then((items) => {
          setResults(items)
        })
        .catch((err) => {
          setResults([])
          setError(err instanceof Error ? err.message : '주소 검색에 실패했습니다.')
        })
        .finally(() => setSearching(false))
    }, 280)

    return () => window.clearTimeout(timer)
  }, [open, query, view])

  useEffect(() => {
    if (!open || view !== 'confirm') return
    const initial = previewRef.current
    if (!initial) return

    let disposed = false

    void (async () => {
      try {
        await loadKakaoMaps()
        if (disposed || !mapElRef.current) return
        tearDownMap()
        mapCleanupRef.current = createAddressMap(mapElRef.current, initial, (next) => {
          setPreview((prev) => ({ ...next, id: prev?.id ?? next.id }))
        })
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : '지도를 불러오지 못했습니다.')
        }
      }
    })()

    return () => {
      disposed = true
      tearDownMap()
    }
  }, [open, view])

  function closeOverlay() {
    tearDownMap()
    setOpen(false)
  }

  function openSearch() {
    setError('')
    setQuery('')
    setResults([])
    setPreview(null)
    setView('search')
    setOpen(true)
  }

  async function openCurrentLocation() {
    if (locating) return
    setError('')
    setQuery('')
    setResults([])
    setPreview(null)
    setView('search')
    setOpen(true)
    setLocating(true)
    try {
      const current = await getCurrentAddress()
      setPreview(current)
      setView('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : '현재 위치를 확인할 수 없습니다.')
    } finally {
      setLocating(false)
    }
  }

  async function selectCandidate(item: AddressCandidate) {
    setError('')
    const enriched = await enrichZonecode(item)
    setPreview(enriched)
    setView('confirm')
  }

  function confirmAddress() {
    if (!preview) return
    const next = {
      zonecode: preview.zonecode,
      address: preview.address,
      addressDetail: value.addressDetail,
    }
    // Detach map SDK before React unmounts the portal — otherwise the map
    // throws during commit and wipes #root.
    tearDownMap()
    onChange(next)
    setOpen(false)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted">주소</p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" disabled={locating} onClick={() => void openCurrentLocation()}>
          <LocateFixed className="h-4 w-4" />
          {locating ? '위치 확인 중' : '현재 위치'}
        </Button>
        <Button type="button" variant="outline" onClick={openSearch}>
          <Search className="h-4 w-4" />
          주소 검색
        </Button>
      </div>

      <button
        type="button"
        onClick={openSearch}
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        {value.address ? (
          <>
            <p className="flex items-start gap-2 text-sm font-medium text-gray-900">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                {value.zonecode ? `[${value.zonecode}] ` : ''}
                {value.address}
              </span>
            </p>
            <p className="mt-1 pl-6 text-xs text-muted">탭하면 주소를 다시 검색합니다</p>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted">
            <MapPin className="h-4 w-4 shrink-0" />
            {emptyHint}
          </p>
        )}
      </button>

      <Input
        label={detailLabel}
        value={value.addressDetail}
        onChange={(e) => onChange({ ...value, addressDetail: e.target.value })}
        placeholder={detailPlaceholder}
      />

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex flex-col bg-white pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-3">
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100"
              aria-label="닫기"
              onClick={closeOverlay}
            >
              <X className="h-5 w-5" />
            </button>
            <h2 className="flex-1 text-base font-bold">
              {view === 'confirm' ? '위치 확인' : searchTitle}
            </h2>
          </div>

          {view === 'search' ? (
            <>
              <div className="space-y-3 px-4 py-3">
                <Field label="주소 검색">
                  <div className="relative mt-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      id={searchId}
                      type="search"
                      enterKeyHint="search"
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.preventDefault()
                      }}
                      placeholder="도로명, 지번 또는 건물명"
                      className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </Field>
                <Button
                  type="button"
                  variant="secondary"
                  fullWidth
                  disabled={locating}
                  onClick={() => void openCurrentLocation()}
                >
                  <LocateFixed className="h-4 w-4" />
                  {locating ? '현재 위치를 확인하는 중...' : '현재 위치로 주소 설정'}
                </Button>
                <ErrorText>{error}</ErrorText>
              </div>

              <div className="flex-1 overflow-y-auto px-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                {locating && (
                  <p className="px-4 py-8 text-center text-sm text-muted">위치를 확인하고 있습니다...</p>
                )}
                {!locating && searching && (
                  <p className="px-4 py-8 text-center text-sm text-muted">주소를 찾는 중...</p>
                )}
                {!locating && !searching && query.trim().length < 2 && (
                  <p className="px-4 py-8 text-center text-sm text-muted">
                    도로명, 지번, 건물명으로 검색하세요
                  </p>
                )}
                {!locating && !searching && query.trim().length >= 2 && results.length === 0 && !error && (
                  <p className="px-4 py-8 text-center text-sm text-muted">검색 결과가 없습니다</p>
                )}
                <ul>
                  {results.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => void selectCandidate(item)}
                        className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left hover:bg-primary-light"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>
                          <span className="block text-sm font-medium text-gray-900">{item.name}</span>
                          <span className="mt-0.5 block text-xs text-muted">{item.address}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            preview && (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                <div ref={mapElRef} className="kakao-map h-56 w-full shrink-0 bg-gray-100" />
                <div className="space-y-3 px-4 py-4">
                  <p className="text-xs text-muted">지도를 탭하면 위치를 미세 조정할 수 있습니다</p>
                  <div className="rounded-xl bg-primary-light px-4 py-3">
                    <p className="text-sm font-semibold text-gray-900">
                      {preview.zonecode ? `[${preview.zonecode}] ` : ''}
                      {preview.address}
                    </p>
                    {preview.name && preview.name !== preview.address && (
                      <p className="mt-1 text-xs text-muted">{preview.name}</p>
                    )}
                  </div>
                  <ErrorText>{error}</ErrorText>
                  <Button type="button" fullWidth size="lg" onClick={confirmAddress}>
                    이 주소로 설정
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    fullWidth
                    onClick={() => {
                      tearDownMap()
                      setView('search')
                      setPreview(null)
                    }}
                  >
                    다시 검색
                  </Button>
                </div>
              </div>
            )
          )}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
