import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, MapPin, Search, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { ErrorText } from '../ui/Feedback'
import {
  buildEpostFallbackQueries,
  buildEpostSearchQuery,
  extractAddressDetail,
  searchEpostAddresses,
  type EpostAddressResult,
} from '../../lib/epostAddress'
import {
  checkAddressDetail,
  isAddressDetailCached,
  summarizeDongs,
  type AddressDetailCheck,
} from '../../lib/jusoBuilding'

type EpostAddressFixDialogProps = {
  open: boolean
  /** 원문 전체 주소(기본+상세). 오류 원본 표시·상세주소 추정용 */
  initialQuery: string
  /** 상세를 뺀 기본주소 — 우체국 검색어·대체 검색어는 이것만으로 만든다 */
  baseAddress: string
  /** 이미 나눠 둔 상세주소 — 확정 화면에 미리 채운다 */
  initialDetail?: string
  /** 검증 단계에서 이미 찾은 다건 후보 */
  initialResults?: EpostAddressResult[]
  /** 우체국 검색창에 넣을 기본주소 검색어 */
  initialSearchQuery?: string
  /** 검증 때 이미 0건으로 확인된 검색어 — 다시 검색하지 않고 대체 검색어부터 찾는다 */
  knownEmptyQueries?: string[]
  onClose: () => void
  onSelect: (result: EpostAddressResult, detail: string) => void
}

/** 카카오맵 검색 페이지. 참고용 iframe — 선택 결과는 받을 수 없다. */
function mapSearchUrl(query: string) {
  const q = query.trim()
  if (!q) return 'https://map.kakao.com/'
  return `https://map.kakao.com/?q=${encodeURIComponent(q)}`
}

/**
 * 기본주소(상세 없음)로 대체 검색어 후보를 만든다. 원문 검색어(검색창에 들어가는 값)는 넣지 않는다.
 * 예: "인천 서구 용해로20" → "인천 용해로 20" / "용해로 20"
 */
function buildAddressSearchSuggestions(baseAddress: string): string[] {
  const baseQuery = buildEpostSearchQuery(baseAddress).trim()
  return [...new Set(buildEpostFallbackQueries(baseAddress))].filter(
    (tip) => tip.trim().length >= 2 && tip.trim() !== baseQuery,
  )
}

export function EpostAddressFixDialog({
  open,
  initialQuery,
  baseAddress,
  initialDetail = '',
  initialResults = [],
  initialSearchQuery = '',
  knownEmptyQueries = [],
  onClose,
  onSelect,
}: EpostAddressFixDialogProps) {
  const epostSearchId = useId()
  const detailId = useId()

  const [view, setView] = useState<'search' | 'confirm'>('search')
  /** lg 미만 화면에서 보여 줄 패널. lg 이상은 두 패널을 나란히 보여 준다. */
  const [mobilePanel, setMobilePanel] = useState<'address' | 'map'>('address')
  const [epostQuery, setEpostQuery] = useState(() => buildEpostSearchQuery(baseAddress))
  const [epostResults, setEpostResults] = useState<EpostAddressResult[]>([])
  const [epostSearching, setEpostSearching] = useState(false)
  const [epostError, setEpostError] = useState('')
  const [preview, setPreview] = useState<EpostAddressResult | null>(null)
  const [addressDetail, setAddressDetail] = useState('')
  const [detailCheck, setDetailCheck] = useState<AddressDetailCheck | null>(null)
  const [detailChecking, setDetailChecking] = useState(false)
  /** 동·호 문제를 보고도 이 주소가 맞다고 확인했는지 */
  const [detailAcknowledged, setDetailAcknowledged] = useState(false)
  const checkedRoadRef = useRef('')
  const [mapSuggestions, setMapSuggestions] = useState<string[]>(() =>
    buildAddressSearchSuggestions(baseAddress),
  )
  const [activeMapQuery, setActiveMapQuery] = useState(() => buildEpostSearchQuery(baseAddress))
  const [mapSrc, setMapSrc] = useState(() => mapSearchUrl(buildEpostSearchQuery(baseAddress)))
  /**
   * 검증에서 받은 다건 후보를 열어 둔 동안 자동 재조회를 막는다.
   * (한 번만 skip 하면 setEpostQuery 다음 effect 에서 다시 조회해 0건으로 덮어쓴다.)
   * 검색창 입력·칩 선택 시에만 해제한다.
   */
  const holdSeededResultsRef = useRef(false)
  /** 창을 열고 원문 검색어로 0건일 때 차례로 돌릴 대체 검색어. 검색창 입력·칩 선택 시 비운다. */
  const fallbackQueueRef = useRef<string[]>([])
  /** 대체 검색어로 넘어갔다면 결과가 없던 원문 검색어 */
  const [fallbackFrom, setFallbackFrom] = useState('')
  const openKeyRef = useRef('')

  useEffect(() => {
    if (!open) return
    const base = baseAddress.trim()
    const searchQuery = initialSearchQuery.trim()
    const openKey = `${initialQuery}||${base}||${searchQuery}||${initialDetail}||${initialResults.map((row) => row.id).join(',')}||${knownEmptyQueries.join(',')}`
    if (openKeyRef.current === openKey) return
    openKeyRef.current = openKey

    const hasSeededHits = initialResults.length > 0
    // 다건 후보가 있으면 그 후보를 찾은 검색어를, 아니면 원문 기본주소 검색어를 넣는다.
    const original =
      (hasSeededHits && searchQuery) || buildEpostSearchQuery(base) || searchQuery || base
    const suggestions = buildAddressSearchSuggestions(base).filter((tip) => tip !== original)
    const isKnownEmpty = (query: string) =>
      knownEmptyQueries.some((empty) => empty.replace(/\s+/g, ' ').trim() === query.trim())
    // 원문 검색어가 검증 때 이미 0건이었으면 바로 대체 검색어로 시작한다.
    const skipOriginal = !hasSeededHits && isKnownEmpty(original)
    const pending = skipOriginal ? suggestions.filter((tip) => !isKnownEmpty(tip)) : suggestions
    const seeded = skipOriginal && pending.length > 0 ? pending[0] : original
    setView('search')
    setMobilePanel('address')
    setPreview(null)
    setAddressDetail(initialDetail.trim())
    setEpostQuery(seeded)
    setEpostResults(initialResults)
    setEpostError('')
    setEpostSearching(false)
    holdSeededResultsRef.current = hasSeededHits
    fallbackQueueRef.current = hasSeededHits ? [] : pending.filter((tip) => tip !== seeded)
    setFallbackFrom(seeded !== original ? original : '')
    setMapSuggestions(suggestions)
    setActiveMapQuery(seeded)
    setMapSrc(mapSearchUrl(seeded))
  }, [
    open,
    initialQuery,
    baseAddress,
    initialDetail,
    initialSearchQuery,
    initialResults,
    knownEmptyQueries,
  ])

  useEffect(() => {
    if (!open) {
      openKeyRef.current = ''
      holdSeededResultsRef.current = false
      return
    }
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

  useEffect(() => {
    if (!open || view !== 'search') return
    const keyword = epostQuery.trim()
    if (keyword.length < 2) {
      if (!holdSeededResultsRef.current) setEpostResults([])
      setEpostSearching(false)
      return
    }

    // 검증 다건 후보를 보여 주는 중이면 자동 조회하지 않는다.
    if (holdSeededResultsRef.current) return

    const timer = window.setTimeout(() => {
      setEpostSearching(true)
      setEpostError('')
      void searchEpostAddresses(keyword)
        .then((items) => {
          if (holdSeededResultsRef.current) return
          const next = items.length === 0 ? fallbackQueueRef.current[0] : undefined
          if (!next) {
            setEpostResults(items)
            return
          }
          // 결과가 없으면 검색창도 대체 검색어로 바꿔서 다시 찾는다.
          fallbackQueueRef.current = fallbackQueueRef.current.slice(1)
          setFallbackFrom((prev) => prev || keyword)
          setActiveMapQuery(next)
          setMapSrc(mapSearchUrl(next))
          setEpostQuery(next)
        })
        .catch((err) => {
          if (holdSeededResultsRef.current) return
          setEpostResults([])
          setEpostError(err instanceof Error ? err.message : '우체국 주소 검색에 실패했습니다.')
        })
        .finally(() => {
          if (!holdSeededResultsRef.current) setEpostSearching(false)
        })
    }, 280)

    return () => window.clearTimeout(timer)
  }, [open, epostQuery, view])

  // 후보가 몇 개뿐이면 고르기 전에 건물 정보를 미리 받아 둔다.
  useEffect(() => {
    if (!open || view !== 'search' || epostResults.length === 0 || epostResults.length > 3) return
    for (const item of epostResults) {
      const road = item.roadAddress || item.jibunAddress
      const detail = initialDetail.trim() || extractAddressDetail(initialQuery, road)
      void checkAddressDetail(road, detail)
    }
  }, [open, view, epostResults, initialDetail, initialQuery])

  useEffect(() => {
    if (!open || view !== 'confirm' || !preview) {
      setDetailCheck(null)
      setDetailChecking(false)
      checkedRoadRef.current = ''
      return
    }
    const road = preview.roadAddress || preview.jibunAddress
    // 처음 열 때와 이미 받아 둔 동은 바로, 입력 중 새 동은 잠깐 기다렸다가 묻는다.
    const cached = isAddressDetailCached(road, addressDetail)
    const immediate = cached || checkedRoadRef.current !== road
    checkedRoadRef.current = road
    let cancelled = false
    if (!cached) setDetailChecking(true)
    const timer = window.setTimeout(
      () => {
        void checkAddressDetail(road, addressDetail)
          .then((result) => {
            if (!cancelled) setDetailCheck(result)
          })
          .finally(() => {
            if (!cancelled) setDetailChecking(false)
          })
      },
      immediate ? 0 : 250,
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, view, preview, addressDetail])

  useEffect(() => {
    setDetailAcknowledged(false)
  }, [detailCheck?.problem, preview])

  function releaseSeededHold() {
    holdSeededResultsRef.current = false
    fallbackQueueRef.current = []
    setFallbackFrom('')
  }

  function selectSuggestion(query: string) {
    releaseSeededHold()
    setActiveMapQuery(query)
    setMapSrc(mapSearchUrl(query))
    setEpostQuery(query)
    setView('search')
    setPreview(null)
  }

  function pickCandidate(item: EpostAddressResult) {
    const seededDetail =
      addressDetail.trim() ||
      extractAddressDetail(initialQuery, item.roadAddress || item.jibunAddress)
    setPreview(item)
    setAddressDetail(seededDetail)
    setView('confirm')
    setMobilePanel('address')
  }

  function renderSuggestionChips() {
    if (mapSuggestions.length === 0) return null
    return (
      <div className="flex flex-wrap gap-2">
        {mapSuggestions.map((tip) => {
          const active = tip === activeMapQuery
          return (
            <button
              key={tip}
              type="button"
              onClick={() => selectSuggestion(tip)}
              className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? 'bg-primary text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              <span className="truncate">{tip}</span>
              <Search className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
            </button>
          )
        })}
      </div>
    )
  }

  function mobileTabClass(panel: 'address' | 'map') {
    return `flex-1 border-b-2 py-2.5 text-sm font-semibold transition-colors ${
      mobilePanel === panel ? 'border-primary text-primary' : 'border-transparent text-muted'
    }`
  }

  const detailProblem = detailCheck?.problem ?? null
  const canConfirm =
    !detailChecking && detailCheck !== null && (!detailProblem || detailAcknowledged)

  function confirmAddress() {
    if (!preview || !canConfirm) return
    onSelect(preview, addressDetail.trim())
  }

  if (!open) return null

  const originalAddress = initialQuery.trim()

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-white pt-[env(safe-area-inset-top)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-3">
        {view === 'confirm' ? (
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100"
            aria-label="뒤로가기"
            onClick={() => {
              setView('search')
              setPreview(null)
            }}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100"
            aria-label="닫기"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        )}
        <h2 className="min-w-0 flex-1 truncate text-base font-bold">
          {view === 'confirm' ? '상세주소 입력' : '주소 수정'}
        </h2>
      </div>

      <div className="flex shrink-0 border-b border-gray-100 lg:hidden" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'address'}
          className={mobileTabClass('address')}
          onClick={() => setMobilePanel('address')}
        >
          {view === 'confirm' ? '상세주소' : '우체국 주소'}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'map'}
          className={mobileTabClass('map')}
          onClick={() => setMobilePanel('map')}
        >
          카카오맵
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          className={`${mobilePanel === 'address' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:flex lg:border-r lg:border-gray-100`}
        >
          {view === 'search' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:overflow-hidden">
              <div className="shrink-0 space-y-3 border-b border-gray-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">우체국 주소</p>
                  <p className="mt-0.5 text-xs text-muted">
                    창구소포 주소검증에 맞는 도로명·우편번호를 고르세요.
                  </p>
                </div>
                {originalAddress ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                    <p className="text-xs font-medium text-red-800">오류 주소 원본</p>
                    <p className="mt-1 break-words text-sm text-red-950">{originalAddress}</p>
                  </div>
                ) : null}
                <Field label="우체국 검색">
                  <div className="relative mt-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      id={epostSearchId}
                      type="search"
                      enterKeyHint="search"
                      autoFocus
                      value={epostQuery}
                      onChange={(e) => {
                        releaseSeededHold()
                        setEpostQuery(e.target.value)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.preventDefault()
                      }}
                      placeholder="도로명, 지번 또는 건물번호"
                      className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </Field>
                {mapSuggestions.length > 0 ? (
                  <div className="space-y-2 lg:hidden">
                    <p className="text-xs font-medium text-gray-700">대체 검색어</p>
                    {renderSuggestionChips()}
                  </div>
                ) : null}
                <ErrorText>{epostError}</ErrorText>
              </div>

              <div className="shrink-0 px-2 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-y-auto">
                {epostSearching && (
                  <p className="px-4 py-8 text-center text-sm text-muted">주소를 찾는 중...</p>
                )}
                {!epostSearching && epostQuery.trim().length < 2 && (
                  <p className="px-4 py-8 text-center text-sm text-muted">도로명이나 지번으로 검색하세요</p>
                )}
                {!epostSearching &&
                  epostQuery.trim().length >= 2 &&
                  epostResults.length === 0 &&
                  !epostError && (
                    <p className="px-4 py-8 text-center text-sm text-muted">검색 결과가 없습니다</p>
                  )}
                {fallbackFrom && !epostSearching && epostResults.length > 0 ? (
                  <p className="mx-2 mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    ‘{fallbackFrom}’(으)로는 검색 결과가 없어 대체 검색어 ‘{epostQuery.trim()}’(으)로
                    검색했습니다.
                  </p>
                ) : null}
                <ul>
                  {epostResults.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => pickCandidate(item)}
                        className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left hover:bg-primary-light"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="block break-words text-sm font-medium text-gray-900">
                            {item.zipNo ? `[${item.zipNo}] ` : ''}
                            {item.roadAddress || item.jibunAddress}
                          </span>
                          {item.jibunAddress && item.jibunAddress !== item.roadAddress ? (
                            <span className="mt-0.5 block break-words text-xs text-muted">
                              {item.jibunAddress}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            preview && (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                <div className="mx-auto w-full max-w-xl space-y-3">
                  {originalAddress ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                      <p className="text-xs font-medium text-red-800">오류 주소 원본</p>
                      <p className="mt-1 break-words text-sm text-red-950">{originalAddress}</p>
                    </div>
                  ) : null}
                  <div className="rounded-xl bg-primary-light px-4 py-3">
                    <p className="break-words text-sm font-semibold text-gray-900">
                      {preview.zipNo ? `[${preview.zipNo}] ` : ''}
                      {preview.roadAddress || preview.jibunAddress}
                    </p>
                    {preview.jibunAddress && preview.jibunAddress !== preview.roadAddress ? (
                      <p className="mt-1 text-xs text-muted">{preview.jibunAddress}</p>
                    ) : null}
                  </div>
                  <Input
                    id={detailId}
                    label="상세주소"
                    value={addressDetail}
                    onChange={(e) => setAddressDetail(e.target.value)}
                    placeholder="동·호수, 아파트·건물명 등"
                    autoFocus
                  />
                  {detailCheck?.info ? (
                    <p className="text-xs text-muted">
                      {detailCheck.info.buildingName || '이 건물'} ·{' '}
                      {detailCheck.info.apartment ? '공동주택' : '일반 건물'}
                      {detailCheck.info.dongs.length > 0
                        ? ` · ${summarizeDongs(detailCheck.info.dongs)}`
                        : ''}
                    </p>
                  ) : null}
                  {!detailChecking && detailProblem ? (
                    <div className="space-y-2 rounded-xl bg-red-50 px-3 py-2.5">
                      <p className="text-sm text-red-800">{detailProblem}</p>
                      <label className="flex items-start gap-2 text-sm text-red-900">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
                          checked={detailAcknowledged}
                          onChange={(e) => setDetailAcknowledged(e.target.checked)}
                        />
                        건물 정보와 다르지만 이 주소가 맞습니다
                      </label>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    fullWidth
                    size="lg"
                    disabled={!canConfirm}
                    onClick={confirmAddress}
                  >
                    {detailChecking || detailCheck === null ? '동·호 확인 중…' : '이 주소로 설정'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    fullWidth
                    onClick={() => {
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
        </section>

        <section
          className={`${mobilePanel === 'map' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col lg:flex`}
        >
          <div className="shrink-0 space-y-3 border-b border-gray-50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">대체 검색어 · 카카오맵</p>
              <p className="mt-0.5 text-xs text-muted">칩을 누르면 우체국 검색과 지도가 함께 바뀝니다.</p>
            </div>
            {renderSuggestionChips()}
          </div>

          <div className="min-h-0 flex-1 bg-gray-50 pb-[env(safe-area-inset-bottom)]">
            <iframe
              key={mapSrc}
              title="카카오맵"
              src={mapSrc}
              className="h-full w-full border-0"
              referrerPolicy="no-referrer-when-downgrade"
              allow="geolocation"
            />
          </div>
        </section>
      </div>
    </div>,
    document.body,
  )
}
