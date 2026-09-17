import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2, MessageSquare, Phone, Trash2 } from 'lucide-react'
import { Header } from '../../components/layout/Header'
import { EpostAddressFixDialog } from '../../components/shared/EpostAddressFixDialog'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Textarea } from '../../components/ui/Field'
import {
  buildEpostSearchQuery,
  extractAddressDetail,
  isEpostAddressResolved,
  searchEpostAddresses,
  type EpostAddressResult,
} from '../../lib/epostAddress'
import { formatPrice } from '../../lib/format'
import { useFarmWorkspace } from '../../lib/farmWorkspace'
import { appendDemoFarmOrders } from '../../lib/demoFarmOrders'

type FieldKey = 'recipientName' | 'phone' | 'address' | 'product' | 'quantity' | 'depositorName' | 'memo'

type FieldMatch = {
  key: FieldKey
  start: number
  end: number
}

type CleanOrder = {
  recipientName: string
  phone: string
  address: string
  /** 동·호 등 — 기본주소와 분리 */
  addressDetail: string
  /** 데모용 우편번호 — 처음부터 있는 상태로 보이게 */
  zonecode: string
  product: string
  quantity: number
  depositorName: string
  memo: string
  /** 원본(지저분한) 메시지에서 하이라이트할 문자열 */
  highlight: Partial<Record<FieldKey, string>>
  raw: string
}

type DraftOrder = CleanOrder & {
  id: string
  blockStart: number
  blockEnd: number
  matches: FieldMatch[]
  addressChecking: boolean
  /** 검증 실패한 필드 → 안내 문구. 주소·연락처·상품 등에 공통 사용 */
  fieldErrors: Partial<Record<FieldKey, string>>
}

type TextRange = {
  start: number
  end: number
  className: string
  title?: string
  interactive?: boolean
  onClick?: () => void
}

/**
 * 더미 데이터.
 * raw = 카톡에서 그대로 긁어 온 것처럼 보이는 원문
 * 나머지 필드 = 카드에 보여줄 깔끔한 결과 (파서 없이 고정)
 */
const SAMPLE_ORDERS: CleanOrder[] = [
  {
    raw: `오후 4:19 초록빛농장 사장님 받는분:서울 마포구 성마산로11길 32-7 예림 아너스아파트 701호
이서준010-1111-2222
보내는분:박하은010-3333-4444`,
    recipientName: '이서준',
    phone: '010-1111-2222',
    address: '서울 마포구 성마산로11길 32-7',
    addressDetail: '예림 아너스아파트 701호',
    // 오타 샘플 — 우편번호 없음 + 변환 후 주소 오류로 표시
    zonecode: '',
    product: '포도즙',
    quantity: 1,
    depositorName: '박하은',
    memo: '',
    highlight: {
      recipientName: '이서준',
      phone: '010-1111-2222',
      address: '서울 마포구 성마산로11길 32-7 예림 아너스아파트 701호',
      depositorName: '박하은010-3333-4444',
    },
  },
  {
    raw: `오후 4:20 초록빛농장 사장님 받는분:경기도 성남시 분당구 서판교로 165 
1202동 103호 
최유진 010-5555-6666
보내는분:박하은 010-3333-4444
오후 4:21 초록빛농장 사장님 포도즙 하나씩 입니다.`,
    recipientName: '이서준',
    phone: '010-1111-2222',
    address: '경기도 성남시 분당구 서판교로 165',
    addressDetail: '1202동 103호',
    zonecode: '13494',
    product: '포도즙',
    quantity: 1,
    depositorName: '박하은',
    memo: '',
    highlight: {
      recipientName: '최유진',
      phone: '010-5555-6666',
      address: `경기도 성남시 분당구 서판교로 165 
1202동 103호`,
      product: '포도즙',
      quantity: '하나씩',
      depositorName: '박하은 010-3333-4444',
    },
  },
  {
    raw: `오후 4:22 초록빛농장 사장님 한도윤
010-7777-8888
부산 해운대구 센텀중앙로97 
바다뷰APT
1502동 804호
오후 4:22 초록빛농장 사장님 씨없는 3kg 입니다.`,
    recipientName: '한도윤',
    phone: '010-7777-8888',
    address: '부산 해운대구 센텀중앙로 97',
    addressDetail: '바다뷰APT 1502동 804호',
    zonecode: '48058',
    product: '씨없는포도 3kg',
    quantity: 1,
    depositorName: '한도윤',
    memo: '',
    highlight: {
      recipientName: '한도윤',
      phone: '010-7777-8888',
      address: `부산 해운대구 센텀중앙로97 
바다뷰APT
1502동 804호`,
      product: '씨없는 3kg',
    },
  },
]

/** 카톡 대화 통째로 붙여넣은 것처럼 보이게 구성 (전부 임의 더미) */
const SAMPLE_MESSAGES = `오후 4:19 초록빛농장 사장님 받는분:서울 마포구 성마산로11길 32-7 예림 아너스아파트 701호
이서준010-1111-2222
보내는분:박하은010-3333-4444
오후 4:20 초록빛농장 사장님 메시지가 삭제되었습니다.
오후 4:20 초록빛농장 사장님 받는분:경기도 성남시 분당구 서판교로 165 
1202동 103호 
최유진 010-5555-6666
보내는분:박하은 010-3333-4444
오후 4:21 초록빛농장 사장님 포도즙 하나씩 입니다.
오후 4:22 초록빛농장 사장님 한도윤
010-7777-8888
부산 해운대구 센텀중앙로97 
바다뷰APT
1502동 804호
오후 4:22 초록빛농장 사장님 씨없는 3kg 입니다.`

const DUMMY_UNIT_PRICE = 25000

const FIELD_META: Record<FieldKey, { label: string; className: string }> = {
  recipientName: { label: '수령인', className: 'bg-sky-200 text-sky-950' },
  phone: { label: '연락처', className: 'bg-emerald-200 text-emerald-950' },
  address: { label: '주소', className: 'bg-amber-200 text-amber-950' },
  product: { label: '상품', className: 'bg-violet-200 text-violet-950' },
  quantity: { label: '수량', className: 'bg-fuchsia-200 text-fuchsia-950' },
  depositorName: { label: '입금자', className: 'bg-lime-200 text-lime-950' },
  memo: { label: '요청사항', className: 'bg-orange-200 text-orange-950' },
}

/** 주소·연락처·상품 등 검증 실패 공통 표시 */
const FIELD_ERROR_CLASS = 'bg-red-200 text-red-950 ring-1 ring-red-400 cursor-pointer'

const CARD_BLOCK_COLORS = [
  'bg-sky-100 ring-1 ring-sky-300',
  'bg-emerald-100 ring-1 ring-emerald-300',
  'bg-violet-100 ring-1 ring-violet-300',
  'bg-amber-100 ring-1 ring-amber-300',
  'bg-rose-100 ring-1 ring-rose-300',
  'bg-cyan-100 ring-1 ring-cyan-300',
]

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildMatches(raw: string, highlight: Partial<Record<FieldKey, string>>): FieldMatch[] {
  const matches: FieldMatch[] = []
  for (const key of Object.keys(FIELD_META) as FieldKey[]) {
    const needle = highlight[key]
    if (!needle) continue
    const start = raw.indexOf(needle)
    if (start < 0) continue
    matches.push({ key, start, end: start + needle.length })
  }
  return matches
}

/** 더미: 카톡 원문은 그대로 두고, 카드 값은 미리 정해 둔 깔끔한 데이터를 쓴다. */
function buildDrafts(text: string): DraftOrder[] {
  return SAMPLE_ORDERS.map((order) => {
    const start = text.indexOf(order.raw)
    const blockStart = start >= 0 ? start : 0
    const blockEnd = start >= 0 ? start + order.raw.length : order.raw.length
    const raw = start >= 0 ? text.slice(blockStart, blockEnd) : order.raw
    // 성마산로 오타는 결과에 그대로 두고 주소 오류로 표시(데모용, API 생략).
    const hasAddressTypo =
      order.address.includes('성마산로') ||
      (order.highlight.address ?? '').includes('성마산로')

    return {
      id: newId(),
      recipientName: order.recipientName,
      phone: order.phone,
      address: order.address,
      addressDetail: order.addressDetail,
      product: order.product,
      quantity: order.quantity,
      depositorName: order.depositorName,
      memo: order.memo,
      highlight: order.highlight,
      raw,
      blockStart,
      blockEnd,
      matches: buildMatches(raw, order.highlight),
      zonecode: hasAddressTypo ? '' : order.zonecode,
      addressChecking: false,
      fieldErrors: hasAddressTypo
        ? { address: '우체국에서 검색되지 않는 주소입니다.' }
        : {},
    }
  })
}

function buildHighlightNodes(text: string, ranges: TextRange[]) {
  const sorted = [...ranges]
    .filter((range) => range.end > range.start && range.start >= 0 && range.end <= text.length)
    .sort((a, b) => a.start - b.start || b.end - a.end)

  const nodes: ReactNode[] = []
  let cursor = 0

  for (const range of sorted) {
    if (range.start < cursor) continue
    if (range.start > cursor) {
      nodes.push(<span key={`t-${cursor}`}>{text.slice(cursor, range.start)}</span>)
    }
    if (range.interactive) {
      nodes.push(
        <button
          key={`h-${range.start}-${range.end}`}
          type="button"
          className={`rounded px-0.5 border-0 p-0 font-inherit align-baseline text-left ${range.className}`}
          title={range.title}
          onClick={range.onClick}
        >
          {text.slice(range.start, range.end)}
        </button>,
      )
    } else {
      nodes.push(
        <mark
          key={`h-${range.start}-${range.end}`}
          className={`rounded px-0.5 ${range.className}`}
          title={range.title}
        >
          {text.slice(range.start, range.end)}
        </mark>,
      )
    }
    cursor = range.end
  }

  if (cursor < text.length) {
    nodes.push(<span key={`t-${cursor}`}>{text.slice(cursor)}</span>)
  }

  return nodes
}

function HighlightedText({ text, ranges, className = '' }: { text: string; ranges: TextRange[]; className?: string }) {
  return (
    <pre className={`whitespace-pre-wrap break-words font-sans text-sm leading-6 text-gray-800 ${className}`}>
      {buildHighlightNodes(text, ranges)}
    </pre>
  )
}

function FieldLegend() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(FIELD_META) as FieldKey[]).map((key) => (
        <span
          key={key}
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${FIELD_META[key].className}`}
        >
          {FIELD_META[key].label}
        </span>
      ))}
      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${FIELD_ERROR_CLASS}`}>
        오류
      </span>
    </div>
  )
}

async function validateDraftAddress(
  draft: DraftOrder,
): Promise<Pick<DraftOrder, 'zonecode' | 'fieldErrors'>> {
  const probe = (draft.highlight.address || draft.address).trim()
  const clearAddressError = () => {
    const next = { ...draft.fieldErrors }
    delete next.address
    return next
  }
  const withAddressError = (message: string) => ({
    ...draft.fieldErrors,
    address: message,
  })

  if (probe.length < 2) {
    return { zonecode: '', fieldErrors: withAddressError('주소가 비어 있습니다.') }
  }

  // TODO(demo): 성마산로 오타 샘플만 오류로 표시. 나머지는 검증 스킵.
  if (!probe.includes('성마산로')) {
    return { zonecode: draft.zonecode || '', fieldErrors: clearAddressError() }
  }

  // 원문 그대로 검색 — 붙여 쓴 주소는 우체국에서 안 나오는 경우가 많다.
  try {
    const direct = await searchEpostAddresses(probe, { countPerPage: 10 })
    if (direct.length > 0 && isEpostAddressResolved(probe, direct)) {
      return { zonecode: direct[0].zipNo, fieldErrors: clearAddressError() }
    }
  } catch {
    // 키 오류 등은 아래에서 정리 검색으로 한 번 더 본다.
  }

  const cleaned = buildEpostSearchQuery(probe)
  if (cleaned.length >= 2 && cleaned !== probe) {
    try {
      const cleanedResults = await searchEpostAddresses(cleaned, { countPerPage: 10 })
      if (cleanedResults.length > 0 && isEpostAddressResolved(probe, cleanedResults)) {
        return { zonecode: cleanedResults[0].zipNo, fieldErrors: clearAddressError() }
      }
      // 정리하면 후보는 나오지만 원문이 확정되지 않으면 수동 선택
      if (cleanedResults.length > 0) {
        return {
          zonecode: '',
          fieldErrors: withAddressError('우체국에서 검색되지 않는 주소입니다.'),
        }
      }
    } catch {
      return {
        zonecode: '',
        fieldErrors: withAddressError('우체국에서 검색되지 않는 주소입니다.'),
      }
    }
  }

  return {
    zonecode: '',
    fieldErrors: withAddressError('우체국에서 검색되지 않는 주소입니다.'),
  }
}

function applyAddressSelection(
  draft: DraftOrder,
  selected: EpostAddressResult,
  detailInput = '',
): DraftOrder {
  const detail =
    detailInput.trim() ||
    extractAddressDetail(draft.address, selected.roadAddress) ||
    extractAddressDetail(
      [draft.address, draft.addressDetail].filter(Boolean).join(' '),
      selected.roadAddress,
    ) ||
    extractAddressDetail(draft.highlight.address || '', selected.roadAddress)
  // 기본주소는 도로명만, 호수·건물명은 상세로 둔다.
  const displayAddress = detail ? `${selected.roadAddress} ${detail}` : selected.roadAddress
  const oldNeedle = draft.highlight.address || [draft.address, draft.addressDetail].filter(Boolean).join(' ')
  const addressMatch = draft.matches.find((match) => match.key === 'address')

  let raw = draft.raw
  let highlight = { ...draft.highlight, address: displayAddress }

  if (addressMatch && oldNeedle) {
    raw = `${draft.raw.slice(0, addressMatch.start)}${displayAddress}${draft.raw.slice(addressMatch.end)}`
  } else if (oldNeedle && draft.raw.includes(oldNeedle)) {
    raw = draft.raw.replace(oldNeedle, displayAddress)
  }

  return {
    ...draft,
    raw,
    address: selected.roadAddress,
    addressDetail: detail,
    zonecode: selected.zipNo,
    addressChecking: false,
    fieldErrors: (() => {
      const next = { ...draft.fieldErrors }
      delete next.address
      return next
    })(),
    highlight,
    matches: buildMatches(raw, highlight),
  }
}

function fieldHighlightClass(
  key: FieldKey,
  fieldErrors: Partial<Record<FieldKey, string>>,
  addressChecking: boolean,
) {
  const errorMessage = fieldErrors[key]
  const isError = Boolean(errorMessage) && !(key === 'address' && addressChecking)
  return {
    isError,
    className: `rounded px-0.5 ${isError ? FIELD_ERROR_CLASS : FIELD_META[key].className}`,
    title: isError ? `${errorMessage} — 눌러서 수정` : FIELD_META[key].label,
  }
}

function DraftFieldMark({
  fieldKey,
  value,
  fieldErrors,
  addressChecking,
  onFixField,
  className = '',
}: {
  fieldKey: FieldKey
  value: string
  fieldErrors: Partial<Record<FieldKey, string>>
  addressChecking: boolean
  onFixField: (key: FieldKey) => void
  className?: string
}) {
  const hi = fieldHighlightClass(fieldKey, fieldErrors, addressChecking)
  if (hi.isError) {
    return (
      <button
        type="button"
        title={hi.title}
        onClick={() => onFixField(fieldKey)}
        className={`${hi.className} border-0 p-0 font-inherit align-baseline text-left ${className}`}
      >
        {value}
      </button>
    )
  }
  return (
    <mark title={hi.title} className={`${hi.className} ${className}`}>
      {value}
    </mark>
  )
}

function DraftOrderCard({
  draft,
  index,
  blockColorClass,
  onRemove,
  onFixField,
}: {
  draft: DraftOrder
  index: number
  blockColorClass: string
  onRemove: () => void
  onFixField: (key: FieldKey) => void
}) {
  const amount = DUMMY_UNIT_PRICE * draft.quantity
  const errorEntries = (Object.keys(draft.fieldErrors) as FieldKey[]).filter(
    (key) => draft.fieldErrors[key],
  )

  const fieldRanges: TextRange[] = draft.matches.map((match) => {
    const errorMessage = draft.fieldErrors[match.key]
    const isError = Boolean(errorMessage) && !(match.key === 'address' && draft.addressChecking)
    return {
      start: match.start,
      end: match.end,
      className: isError ? FIELD_ERROR_CLASS : FIELD_META[match.key].className,
      title: isError ? `${errorMessage} — 눌러서 수정` : FIELD_META[match.key].label,
      interactive: isError,
      onClick: isError ? () => onFixField(match.key) : undefined,
    }
  })

  const markProps = {
    fieldErrors: draft.fieldErrors,
    addressChecking: draft.addressChecking,
    onFixField,
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold leading-none tabular-nums ${blockColorClass}`}
          >
            {index + 1}
          </span>
          <p className="text-xs text-muted">DRAFT-{String(index + 1).padStart(3, '0')}</p>
          <FieldLegend />
        </div>
        <button
          type="button"
          aria-label={`${index + 1}번 주문 삭제`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-600"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {draft.addressChecking ? (
        <p className="mt-2 text-xs text-muted">우체국 주소 확인 중...</p>
      ) : null}
      {errorEntries.length > 0 && !draft.addressChecking ? (
        <div className="mt-2 space-y-1.5">
          {errorEntries.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onFixField(key)}
              className="flex w-full items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-left text-sm text-red-800 hover:bg-red-100"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span className="min-w-0 truncate">
                <span className="font-medium">
                  {FIELD_META[key].label} 오류 · {draft.fieldErrors[key]}
                </span>
                <span className="text-red-700"> — 눌러서 수정하세요.</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <div className="min-w-0 flex-1 space-y-2 lg:pr-3 lg:border-r lg:border-gray-100">
          <p className="text-xs font-medium text-muted">원본 메시지</p>
          <HighlightedText
            text={draft.raw}
            ranges={fieldRanges}
            className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5"
          />
        </div>

        <div className="min-w-0 flex-1 border-t border-gray-100 pt-3 lg:border-t-0 lg:pt-0 lg:pl-3">
          <p className="mb-2 text-xs font-medium text-muted">추출 결과</p>
          <h4 className="font-semibold text-gray-900">
            {draft.recipientName ? (
              <DraftFieldMark fieldKey="recipientName" value={draft.recipientName} {...markProps} />
            ) : (
              '수령인 없음'
            )}
          </h4>
          {draft.address ? (
            <p className="mt-1 text-sm text-gray-700">
              {draft.zonecode ? `[${draft.zonecode}] ` : ''}
              <DraftFieldMark fieldKey="address" value={draft.address} {...markProps} />
              {draft.addressDetail ? ` ${draft.addressDetail}` : ''}
            </p>
          ) : null}

          {draft.phone ? (
            <p className="mt-0.5 text-sm text-gray-700">
              <a
                href={`tel:${draft.phone.replace(/[^0-9+]/g, '')}`}
                className="inline-flex items-center gap-1 hover:text-primary"
              >
                <Phone className="h-3.5 w-3.5 shrink-0 text-muted" />
                <DraftFieldMark fieldKey="phone" value={draft.phone} {...markProps} />
              </a>
            </p>
          ) : null}

          {draft.depositorName && draft.depositorName !== draft.recipientName ? (
            <p className="mt-0.5 text-xs text-muted">
              보내는 분 ·{' '}
              <DraftFieldMark fieldKey="depositorName" value={draft.depositorName} {...markProps} />
            </p>
          ) : null}

          {draft.memo ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-sm text-amber-900">
              <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <p>
                <span className="font-medium">요청사항</span>
                <span className="text-amber-700">
                  {' '}
                  · <DraftFieldMark fieldKey="memo" value={draft.memo} {...markProps} />
                </span>
              </p>
            </div>
          ) : null}

          <div className="mt-3 border-t border-gray-100 pt-2">
            <p className="text-sm text-gray-700">
              {draft.product ? (
                <DraftFieldMark fieldKey="product" value={draft.product} {...markProps} />
              ) : (
                '상품 없음'
              )}{' '}
              <span className="text-muted">
                · 수량{' '}
                <DraftFieldMark
                  fieldKey="quantity"
                  value={String(draft.quantity)}
                  {...markProps}
                />
              </span>
            </p>
            <p className="mt-1 font-semibold text-primary">{formatPrice(amount)}</p>
          </div>
        </div>
      </div>
    </Card>
  )
}

export function FarmOrderCreate() {
  const { farm, basePath } = useFarmWorkspace()
  const navigate = useNavigate()
  const [messageText, setMessageText] = useState('')
  const [drafts, setDrafts] = useState<DraftOrder[]>([])
  const [parsedSource, setParsedSource] = useState('')
  const [fixDraftId, setFixDraftId] = useState<string | null>(null)
  const [fixFieldKey, setFixFieldKey] = useState<FieldKey | null>(null)
  const [converting, setConverting] = useState(false)

  // 들어올 때마다 비운다. 샘플 문구는 placeholder 로만 보여 준다.
  useEffect(() => {
    setMessageText('')
    setDrafts([])
    setParsedSource('')
    setFixDraftId(null)
    setFixFieldKey(null)
    setConverting(false)
  }, [])

  const countLabel = useMemo(() => `${drafts.length}건`, [drafts.length])
  const fixDraft = drafts.find((row) => row.id === fixDraftId) ?? null
  const errorCount = drafts.filter(
    (row) => !row.addressChecking && Object.keys(row.fieldErrors).length > 0,
  ).length

  const blockRanges: TextRange[] = useMemo(
    () =>
      drafts.map((draft, index) => ({
        start: draft.blockStart,
        end: draft.blockEnd,
        className: CARD_BLOCK_COLORS[index % CARD_BLOCK_COLORS.length],
        title: `주문 ${index + 1}`,
      })),
    [drafts],
  )

  useEffect(() => {
    let cancelled = false
    const pending = drafts.filter((row) => row.addressChecking)
    if (pending.length === 0) return

    void (async () => {
      const updates = await Promise.all(
        pending.map(async (draft) => {
          const result = await validateDraftAddress(draft)
          return { id: draft.id, ...result }
        }),
      )
      if (cancelled) return
      setDrafts((prev) =>
        prev.map((row) => {
          const hit = updates.find((item) => item.id === row.id)
          if (!hit) return row
          return {
            ...row,
            zonecode: hit.zonecode,
            fieldErrors: hit.fieldErrors,
            addressChecking: false,
          }
        }),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [drafts])

  async function applyParse() {
    if (converting) return
    setConverting(true)
    setFixDraftId(null)
    setFixFieldKey(null)
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      setDrafts(buildDrafts(messageText))
      setParsedSource(messageText)
    } finally {
      setConverting(false)
    }
  }

  function removeDraft(id: string) {
    setDrafts((prev) => prev.filter((row) => row.id !== id))
    if (fixDraftId === id) {
      setFixDraftId(null)
      setFixFieldKey(null)
    }
  }

  function openFieldFix(draftId: string, key: FieldKey) {
    setFixDraftId(draftId)
    setFixFieldKey(key)
  }

  function handleSelectAddress(selected: EpostAddressResult, detail: string) {
    if (!fixDraftId) return
    setDrafts((prev) =>
      prev.map((row) =>
        row.id === fixDraftId ? applyAddressSelection(row, selected, detail) : row,
      ),
    )
    setFixDraftId(null)
    setFixFieldKey(null)
  }

  return (
    <>
      <Header title="직접 추가하기" subtitle={farm.name} showBack backTo={`${basePath}/orders`} />
      <div className="px-4 py-4 md:px-6 max-w-5xl mx-auto space-y-4">
        <Card className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">주문 메시지 일괄 입력</h2>
            <p className="mt-1 text-xs text-muted">
              카톡 대화를 그대로 붙여넣으세요. 시간·닉네임·삭제된 메시지까지 섞여 있어도 됩니다.
            </p>
          </div>
          <Textarea
            label="주문 메시지"
            rows={14}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="여러개 주문을 한번에 입력해주세요"
          />
          <div className="flex flex-wrap gap-2 justify-end">
            <Button type="button" size="sm" disabled={converting} onClick={() => void applyParse()}>
              {converting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  변환 중…
                </>
              ) : (
                '카드로 변환'
              )}
            </Button>
          </div>

          {drafts.length > 0 && (
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted">변환 구간 미리보기</p>
                <div className="flex flex-wrap gap-1.5">
                  {drafts.map((draft, index) => (
                    <span
                      key={draft.id}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CARD_BLOCK_COLORS[index % CARD_BLOCK_COLORS.length]}`}
                    >
                      주문 {index + 1}
                    </span>
                  ))}
                </div>
              </div>
              <HighlightedText
                text={parsedSource}
                ranges={blockRanges}
                className="rounded-xl border border-gray-100 bg-white px-3 py-2.5"
              />
            </div>
          )}
        </Card>

        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">주문 · {countLabel}</h2>
          {drafts.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted hover:text-gray-700"
              onClick={() => setDrafts([])}
            >
              전체 비우기
            </button>
          )}
        </div>

        {errorCount > 0 ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
            확인이 필요한 항목이 {errorCount}건 있습니다. 빨간 표시를 눌러 수정하세요.
          </p>
        ) : null}

        <div className="space-y-3">
          {drafts.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-10 text-center text-sm text-muted">
              위 메시지를 입력한 뒤 &quot;카드로 변환&quot;을 누르면 여기에 주문 카드가 생깁니다.
            </p>
          ) : (
            drafts.map((draft, index) => (
              <DraftOrderCard
                key={draft.id}
                draft={draft}
                index={index}
                blockColorClass={CARD_BLOCK_COLORS[index % CARD_BLOCK_COLORS.length]}
                onRemove={() => removeDraft(draft.id)}
                onFixField={(key) => openFieldFix(draft.id, key)}
              />
            ))
          )}
        </div>

        <div className="flex gap-2 justify-end pb-4">
          <Button type="button" variant="outline" onClick={() => navigate(`${basePath}/orders`)}>
            취소
          </Button>
          <Button
            type="button"
            disabled={drafts.length === 0 || errorCount > 0}
            onClick={() => {
              appendDemoFarmOrders(
                farm.id,
                drafts.map((draft) => ({
                  id: draft.id,
                  recipientName: draft.recipientName,
                  phone: draft.phone,
                  address: draft.address,
                  addressDetail: draft.addressDetail,
                  zonecode: draft.zonecode,
                  product: draft.product,
                  quantity: draft.quantity,
                  depositorName: draft.depositorName,
                  memo: draft.memo,
                  unitPrice: DUMMY_UNIT_PRICE,
                })),
              )
              navigate(`${basePath}/orders?status=pending_deposit`)
            }}
          >
            {drafts.length > 0 ? `${drafts.length}건 주문 추가` : '주문 추가'}
          </Button>
        </div>
      </div>

      <EpostAddressFixDialog
        open={Boolean(fixDraft) && fixFieldKey === 'address'}
        initialQuery={
          fixDraft
            ? [fixDraft.highlight.address || fixDraft.address, fixDraft.addressDetail]
                .filter(Boolean)
                .join(' ')
            : ''
        }
        onClose={() => {
          setFixDraftId(null)
          setFixFieldKey(null)
        }}
        onSelect={handleSelectAddress}
      />
    </>
  )
}
