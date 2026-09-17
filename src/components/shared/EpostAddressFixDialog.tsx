import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, MapPin, Search, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { ErrorText } from '../ui/Feedback'
import {
  // buildEpostSearchQuery, // TODO(demo): 검색어 파싱 복구 시 사용
  extractAddressDetail,
  searchEpostAddresses,
  type EpostAddressResult,
} from '../../lib/epostAddress'

type EpostAddressFixDialogProps = {
  open: boolean
  initialQuery: string
  onClose: () => void
  onSelect: (result: EpostAddressResult, detail: string) => void
}

/** 카카오맵 검색 페이지. 참고용 iframe — 선택 결과는 받을 수 없다. */
function mapSearchUrl(query: string) {
  const q = query.trim()
  if (!q) return 'https://map.kakao.com/'
  return `https://map.kakao.com/?q=${encodeURIComponent(q)}`
}

/** 원 주소에서 카카오맵용 짧은 검색어 후보를 만든다. */
function buildMapSuggestions(address: string): string[] {
  let rest = address.replace(/\s+/g, ' ').trim()
  if (!rest) return []

  rest = rest.replace(
    /^(서울(특별시)?|부산(광역시)?|대구(광역시)?|인천(광역시)?|광주(광역시)?|대전(광역시)?|울산(광역시)?|세종(특별자치시)?)\s*/,
    '',
  )

  const district = rest.match(/^([가-힣]+구)\s*/)?.[1]
  if (district) rest = rest.replace(/^[가-힣]+구\s*/, '')

  // 끝의 동·호 제거 — 701호
  rest = rest.replace(/\s+\d+\s*동(?:\s*\d+\s*호)?\s*$/, '').replace(/\s+\d+\s*호\s*$/, '').trim()

  // 끝의 건물명 — 예림 아너스아파트
  let building = ''
  const buildingMatch = rest.match(/\s+([가-힣]+(?:\s+[가-힣]+)*)(아파트|빌라|빌딩|타워|오피스텔)\s*$/)
  if (buildingMatch) {
    building = `${buildingMatch[1].replace(/\s+/g, '')}${buildingMatch[2]}`
    rest = rest.slice(0, -buildingMatch[0].length).trim()
  }

  // 남은 도로+번지 — 성마산로11길 32-7
  const roadRaw = rest.trim()
  const roadSpaced = roadRaw.replace(/(대로|로|길)(\d)/g, '$1 $2')

  const out: string[] = []
  if (building) out.push(building)
  if (roadSpaced) out.push(roadSpaced)
  // 구 + 전체 도로명(성마산로 11길 포함) — 마포구 성마산로 11길 32-7
  if (district && roadSpaced) out.push(`${district} ${roadSpaced}`)
  return [...new Set(out)].slice(0, 3)
}

export function EpostAddressFixDialog({
  open,
  initialQuery,
  onClose,
  onSelect,
}: EpostAddressFixDialogProps) {
  const epostSearchId = useId()
  const detailId = useId()

  const [view, setView] = useState<'search' | 'confirm'>('search')
  const [epostQuery, setEpostQuery] = useState(initialQuery)
  const [epostResults, setEpostResults] = useState<EpostAddressResult[]>([])
  const [epostSearching, setEpostSearching] = useState(false)
  const [epostError, setEpostError] = useState('')
  const [preview, setPreview] = useState<EpostAddressResult | null>(null)
  const [addressDetail, setAddressDetail] = useState('')
  const [mapSuggestions, setMapSuggestions] = useState<string[]>(() =>
    buildMapSuggestions(initialQuery),
  )
  const [activeMapQuery, setActiveMapQuery] = useState(
    () => buildMapSuggestions(initialQuery)[0] ?? initialQuery,
  )
  const [mapSrc, setMapSrc] = useState(() =>
    mapSearchUrl(buildMapSuggestions(initialQuery)[0] ?? initialQuery),
  )

  useEffect(() => {
    if (!open) return
    // TODO(demo): 파싱 대신 고정 검색어. 원래: buildEpostSearchQuery(initialQuery) || initialQuery.trim()
    const seeded = '서울 마포구 성마산로 11길 32-7'
    setView('search')
    setPreview(null)
    setAddressDetail('')
    setEpostQuery(seeded)
    setEpostResults([])
    setEpostError('')
    const tips = buildMapSuggestions(initialQuery)
    const first = tips[0] ?? (initialQuery.trim() || seeded)
    setMapSuggestions(tips.length > 0 ? tips : first ? [first] : [])
    setActiveMapQuery(first)
    setMapSrc(mapSearchUrl(first))
  }, [open, initialQuery])

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

  useEffect(() => {
    if (!open || view !== 'search') return
    const keyword = epostQuery.trim()
    if (keyword.length < 2) {
      setEpostResults([])
      setEpostSearching(false)
      return
    }

    const timer = window.setTimeout(() => {
      setEpostSearching(true)
      setEpostError('')
      void searchEpostAddresses(keyword)
        .then((items) => setEpostResults(items))
        .catch((err) => {
          setEpostResults([])
          setEpostError(err instanceof Error ? err.message : '우체국 주소 검색에 실패했습니다.')
        })
        .finally(() => setEpostSearching(false))
    }, 280)

    return () => window.clearTimeout(timer)
  }, [open, epostQuery, view])

  function selectMapSuggestion(query: string) {
    setActiveMapQuery(query)
    setMapSrc(mapSearchUrl(query))
  }

  function pickCandidate(item: EpostAddressResult) {
    const seededDetail =
      extractAddressDetail(initialQuery, item.roadAddress || item.jibunAddress) ||
      // TODO(demo): 원문에서 못 뽑으면 샘플 상세
      '예림 아너스아파트 701호'
    setPreview(item)
    setAddressDetail(seededDetail)
    setView('confirm')
  }

  function confirmAddress() {
    if (!preview) return
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
        <h2 className="flex-1 text-base font-bold">
          {view === 'confirm' ? '상세주소 입력' : '주소 수정'}
        </h2>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 왼쪽: 우체국 */}
        <section className="flex min-h-0 flex-1 flex-col border-b border-gray-100 lg:border-b-0 lg:border-r">
          {view === 'search' ? (
            <>
              <div className="space-y-3 border-b border-gray-50 px-4 py-3">
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
                      onChange={(e) => setEpostQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.preventDefault()
                      }}
                      placeholder="도로명, 지번 또는 건물번호"
                      className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </Field>
                <ErrorText>{epostError}</ErrorText>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
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
                <ul>
                  {epostResults.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => pickCandidate(item)}
                        className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left hover:bg-primary-light"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>
                          <span className="block text-sm font-medium text-gray-900">
                            {item.zipNo ? `[${item.zipNo}] ` : ''}
                            {item.roadAddress || item.jibunAddress}
                          </span>
                          {item.jibunAddress && item.jibunAddress !== item.roadAddress ? (
                            <span className="mt-0.5 block text-xs text-muted">{item.jibunAddress}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            preview && (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                <div className="space-y-3">
                  {originalAddress ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                      <p className="text-xs font-medium text-red-800">오류 주소 원본</p>
                      <p className="mt-1 break-words text-sm text-red-950">{originalAddress}</p>
                    </div>
                  ) : null}
                  <div className="rounded-xl bg-primary-light px-4 py-3">
                    <p className="text-sm font-semibold text-gray-900">
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
                  <Button type="button" fullWidth size="lg" onClick={confirmAddress}>
                    이 주소로 설정
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

        {/* 오른쪽: 카카오맵 iframe (참고용) */}
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-3 border-b border-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">카카오맵</p>
            <div className="flex flex-wrap gap-2">
              {mapSuggestions.map((tip) => {
                const active = tip === activeMapQuery
                return (
                  <button
                    key={tip}
                    type="button"
                    onClick={() => selectMapSuggestion(tip)}
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-primary text-white'
                        : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                    }`}
                  >
                    <span className="whitespace-nowrap">{tip}</span>
                    <Search className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-gray-50">
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
