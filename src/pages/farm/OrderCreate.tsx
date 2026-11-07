import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2, MessageSquare, Phone, Trash2, X } from 'lucide-react'
import { Header } from '../../components/layout/Header'
import { EpostAddressFixDialog } from '../../components/shared/EpostAddressFixDialog'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input, Textarea } from '../../components/ui/Field'
import {
  buildEpostSearchQuery,
  extractAddressDetail,
  findDistrictMismatch,
  normalizeAddressParts,
  resolveUniqueEpostMatch,
  searchEpostAddresses,
  type EpostAddressResult,
} from '../../lib/epostAddress'
import { formatPrice } from '../../lib/format'
import { checkAddressDetail } from '../../lib/jusoBuilding'
import { useFarmWorkspace } from '../../lib/farmWorkspace'
import { appendDemoFarmOrders } from '../../lib/demoFarmOrders'
import { matchFarmProduct } from '../../lib/matchFarmProduct'
import { matchFarmProductsRemote } from '../../lib/matchFarmProductsRemote'
import { clearSharedOrderText, peekSharedOrderText } from '../../lib/nativeShare'
import { normalizePhone } from '../../lib/phone'
import {
  parseOrderMessages,
  type ParsedOrderMessage,
} from '../../lib/parseOrderMessages'
import { supabase } from '../../lib/supabase'
import type { Product } from '../../types/models'
import { isProductOrderable } from '../../types/models'

type FieldKey =
  | 'recipientName'
  | 'phone'
  | 'address'
  | 'product'
  | 'quantity'
  | 'senderName'
  | 'senderPhone'
  | 'depositorName'
  | 'memo'

type FieldMatch = {
  key: FieldKey
  start: number
  end: number
}

type DraftOrder = {
  id: string
  recipientName: string
  phone: string
  address: string
  /** 동·호 등 — 기본주소와 분리 */
  addressDetail: string
  zonecode: string
  /** 농가 상품명(매칭·선택 후). 미매칭이면 원문 문구 */
  product: string
  productId: string | null
  unitPrice: number
  /** 카톡에서 뽑은 상품 원문 */
  productQuery: string
  quantity: number
  senderName: string
  senderPhone: string
  depositorName: string
  memo: string
  /** 원본 메시지에서 하이라이트할 문자열 */
  highlight: Partial<Record<FieldKey, string>>
  raw: string
  blockStart: number
  blockEnd: number
  /** Claude 가 이 주문에 병합한 보완 말풍선 구간 */
  supplementSpans: Array<{ start: number; end: number }>
  /** 보완 말풍선 원문과 그 안의 필드 위치 — 원본 메시지에 함께 보여 준다 */
  supplements: Array<{ text: string; matches: FieldMatch[] }>
  matches: FieldMatch[]
  addressChecking: boolean
  /** 검증 때 다건으로 나온 우체국 후보 — 수정 창에 그대로 보여 준다 */
  addressCandidates: EpostAddressResult[]
  /** 그 후보를 만든 검색어 */
  addressSearchQuery: string
  /** 검증 때 우체국 결과가 0건이었던 검색어 — 수정 창에서 다시 검색하지 않는다 */
  addressEmptyQueries: string[]
  /** 검증 실패한 필드 → 안내 문구 */
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

const PLACEHOLDER_MESSAGES = `오후 4:19 초록빛농장 사장님 받는분:서울 마포구 성산로11길 32-7 예림 아너스아파트 701호
이서준010-1111-2222
보내는분:박하은010-3333-4444
오후 4:20 초록빛농장 사장님 메시지가 삭제되었습니다.
오후 4:20 초록빛농장 사장님 받는분:경기도 성남시 분당구 서판교로 165
1202동 103호
최유진 010-5555-6666
보내는분:박하은 010-3333-4444
오후 4:21 초록빛농장 사장님 포도즙 하나씩 입니다.`

const FIELD_META: Record<FieldKey, { label: string; className: string }> = {
  recipientName: { label: '수령인', className: 'bg-sky-200 text-sky-950' },
  phone: { label: '연락처', className: 'bg-emerald-200 text-emerald-950' },
  address: { label: '주소', className: 'bg-amber-200 text-amber-950' },
  senderName: { label: '보내는분', className: 'bg-rose-200 text-rose-950' },
  senderPhone: { label: '보내는전화', className: 'bg-indigo-200 text-indigo-950' },
  product: { label: '상품', className: 'bg-violet-200 text-violet-950' },
  quantity: { label: '수량', className: 'bg-fuchsia-200 text-fuchsia-950' },
  depositorName: { label: '입금자', className: 'bg-lime-200 text-lime-950' },
  memo: { label: '요청사항', className: 'bg-orange-200 text-orange-950' },
}

/** 주소·연락처·상품 등 검증 실패 공통 표시 */
const FIELD_ERROR_CLASS = 'bg-red-200 text-red-950 ring-1 ring-red-400 cursor-pointer'

/** 주문처럼 보이는데 연결에 실패한 원문(중복 재전송은 여기 안 넣음) */
const UNMATCHED_ORDER_CLASS = 'bg-red-200 text-red-950 ring-1 ring-red-400'

const CARD_BLOCK_COLORS = [
  'bg-sky-100 ring-1 ring-sky-300',
  'bg-emerald-100 ring-1 ring-emerald-300',
  'bg-violet-100 ring-1 ring-violet-300',
  'bg-amber-100 ring-1 ring-amber-300',
  'bg-rose-100 ring-1 ring-rose-300',
  'bg-cyan-100 ring-1 ring-cyan-300',
]

const ORDER_LIKE_RE =
  /01[016789]\s*\d{3,4}\s*\d{4}|(?:\d{2,3})\s*동|(?:\d{1,4})\s*호|아파트|APT|[가-힣]+(?:특별시|광역시|시|군|구)|[가-힣]+(?:로|길)\s*\d|키로|kg|박스|포도|보내는|받는분|입금|전화|\d+\s*개|하나|두\s*박스|세\s*박스|한\s*박스/i

function recoverSourceSlice(haystack: string, needle: string): { start: number; end: number } | null {
  const trimmed = needle.trim()
  if (!trimmed || !haystack) return null
  const exact = haystack.indexOf(trimmed)
  if (exact >= 0) return { start: exact, end: exact + trimmed.length }

  const compactNeedle = trimmed.replace(/\s+/g, '')
  if (!compactNeedle) return null
  const compactIndex: number[] = []
  for (let i = 0; i < haystack.length; i++) {
    if (/\s/.test(haystack[i])) continue
    compactIndex.push(i)
  }
  const compactHay = haystack.replace(/\s+/g, '')
  const at = compactHay.indexOf(compactNeedle)
  if (at < 0) return null
  const start = compactIndex[at]
  const end = compactIndex[at + compactNeedle.length - 1] + 1
  return { start, end }
}

function markCovered(covered: boolean[], start: number, end: number) {
  const from = Math.max(0, start)
  const to = Math.min(covered.length, end)
  for (let i = from; i < to; i++) covered[i] = true
}

function markNeedleCovered(covered: boolean[], source: string, needle: string) {
  const hit = recoverSourceSlice(source, needle)
  if (!hit) return
  markCovered(covered, hit.start, hit.end)
}

function draftCoverageNeedles(draft: DraftOrder): string[] {
  return [
    draft.recipientName,
    draft.phone,
    draft.address,
    draft.addressDetail,
    draft.product,
    draft.productQuery,
    draft.senderName,
    draft.senderPhone,
    draft.depositorName,
    draft.memo,
    ...Object.values(draft.highlight),
  ].filter((value): value is string => Boolean(value && value.trim()))
}

/** 카톡 헤더·빈 줄이 아니라, 주문 정보로 보이는 미연결 문구인지 */
function looksLikeUnmatchedOrderContent(chunk: string): boolean {
  const body = chunk
    .replace(/(?:오전|오후)\s*\d{1,2}:\d{2}\s*/g, ' ')
    .replace(/메시지가 삭제되었습니다\.?/g, ' ')
    .replace(/사장님/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (body.length < 2) return false
  if (ORDER_LIKE_RE.test(body)) return true
  // 숫자+한글이 섞인 짧은 주문 조각 (예: 노윈구3키로2박스)
  if (/[가-힣]/.test(body) && /\d/.test(body) && body.length >= 4) return true
  return false
}

function splitPreviewBubbles(source: string): Array<{ start: number; end: number }> {
  const headerRe = /(?:오전|오후)\s*\d{1,2}:\d{2}\s+/g
  const starts: number[] = []
  for (const match of source.matchAll(headerRe)) {
    if (match.index != null) starts.push(match.index)
  }
  if (starts.length === 0) {
    return source.trim() ? [{ start: 0, end: source.length }] : []
  }
  const bubbles: Array<{ start: number; end: number }> = []
  if (starts[0] > 0) bubbles.push({ start: 0, end: starts[0] })
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    const end = i + 1 < starts.length ? starts[i + 1] : source.length
    bubbles.push({ start, end })
  }
  return bubbles
}

function findUnmatchedOrderRanges(
  source: string,
  drafts: DraftOrder[],
  ignoredSpans: Array<{ start: number; end: number }> = [],
): TextRange[] {
  if (!source || drafts.length === 0) return []
  const covered = Array.from({ length: source.length }, () => false)

  for (const draft of drafts) {
    if (draft.blockEnd > draft.blockStart) {
      markCovered(covered, draft.blockStart, draft.blockEnd)
    }
    for (const span of draft.supplementSpans) {
      markCovered(covered, span.start, span.end)
    }
    for (const needle of draftCoverageNeedles(draft)) {
      markNeedleCovered(covered, source, needle)
    }
  }
  // Claude 가 무시(재전송 등)로 판단한 구간은 미연결이 아니다.
  for (const span of ignoredSpans) {
    markCovered(covered, span.start, span.end)
  }

  const ranges: TextRange[] = []
  for (const bubble of splitPreviewBubbles(source)) {
    let i = bubble.start
    while (i < bubble.end) {
      while (i < bubble.end && covered[i]) i++
      if (i >= bubble.end) break
      let j = i
      while (j < bubble.end && !covered[j]) j++
      const chunk = source.slice(i, j)
      if (looksLikeUnmatchedOrderContent(chunk)) {
        const leading = chunk.match(/^\s*/)?.[0].length ?? 0
        const trailing = chunk.match(/\s*$/)?.[0].length ?? 0
        const start = i + leading
        const end = j - trailing
        if (end > start) {
          ranges.push({
            start,
            end,
            className: UNMATCHED_ORDER_CLASS,
            title: '미연결 — 주문으로 보이지만 카드에 넣지 못함',
          })
        }
      }
      i = j
    }
  }
  return ranges
}

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

function applyProductSelection(draft: DraftOrder, product: Product): DraftOrder {
  const nextErrors = { ...draft.fieldErrors }
  delete nextErrors.product
  return {
    ...draft,
    product: product.name,
    productId: product.id,
    unitPrice: product.price,
    fieldErrors: nextErrors,
  }
}

function resolveDraftProduct(
  draft: Omit<DraftOrder, 'product' | 'productId' | 'unitPrice' | 'fieldErrors'> & {
    fieldErrors?: DraftOrder['fieldErrors']
  },
  productQuery: string,
  catalog: Product[],
): Pick<DraftOrder, 'product' | 'productId' | 'unitPrice' | 'fieldErrors'> {
  const fieldErrors = { ...(draft.fieldErrors ?? {}) }
  const hit = matchFarmProduct(productQuery, catalog)
  if (hit) {
    delete fieldErrors.product
    return {
      product: hit.product.name,
      productId: hit.product.id,
      unitPrice: hit.product.price,
      fieldErrors,
    }
  }
  fieldErrors.product = productQuery.trim()
    ? '농가 상품 목록과 일치하지 않습니다.'
    : '상품을 선택해 주세요.'
  return {
    product: productQuery.trim(),
    productId: null,
    unitPrice: 0,
    fieldErrors,
  }
}

/** 원문에서 기본주소 시작부터 상세주소 끝까지(사이 줄바꿈·쉼표 포함) 그대로 잘라 준다. */
function findAddressSpanText(raw: string, address: string, detail: string): string {
  const base = recoverSourceSlice(raw, address)
  if (!base) return ''
  let end = base.end
  if (detail.trim()) {
    const rest = raw.slice(base.end)
    const detailHit = recoverSourceSlice(rest, detail)
    // 상세주소가 기본주소 바로 뒤(구분 기호만 사이)에 있을 때만 이어 붙인다.
    if (detailHit && /^[\s,]*$/.test(rest.slice(0, detailHit.start))) {
      end = base.end + detailHit.end
    }
  }
  return raw.slice(base.start, end)
}

function toDraftOrder(order: ParsedOrderMessage, source: string, catalog: Product[]): DraftOrder {
  let blockStart = order.blockStart
  let blockEnd = order.blockEnd
  let raw = order.raw

  if (
    blockStart == null ||
    blockEnd == null ||
    blockStart < 0 ||
    blockEnd <= blockStart ||
    blockEnd > source.length
  ) {
    const found = source.indexOf(raw)
    blockStart = found >= 0 ? found : 0
    blockEnd = found >= 0 ? found + raw.length : raw.length
    raw = found >= 0 ? source.slice(blockStart, blockEnd) : raw
  } else {
    raw = source.slice(blockStart, blockEnd)
  }

  const parts = normalizeAddressParts(order.address, order.addressDetail)
  const highlight: Partial<Record<FieldKey, string>> = {}
  for (const key of Object.keys(FIELD_META) as FieldKey[]) {
    const needle = order.highlight[key]
    if (needle && raw.includes(needle)) highlight[key] = needle
  }

  const supplementNeedles: Partial<Record<FieldKey, string>> = {
    recipientName: order.highlight.recipientName || order.recipientName,
    phone: order.highlight.phone || order.phone,
    product: order.highlight.product || order.product,
    senderName: order.highlight.senderName || order.senderName,
    senderPhone: order.highlight.senderPhone || order.senderPhone,
    depositorName: order.highlight.depositorName || order.depositorName,
    memo: order.highlight.memo || order.memo,
  }
  // 수량은 "2" 같은 한 글자가 엉뚱한 곳에 맞을 수 있어 충분히 긴 문구만 칠한다.
  if ((order.highlight.quantity ?? '').trim().length >= 2) {
    supplementNeedles.quantity = order.highlight.quantity
  }
  const supplements = order.supplementSpans.map((span) => {
    const text = source.slice(span.start, span.end)
    return { text, matches: buildMatches(text, supplementNeedles) }
  })

  // 하이라이트는 기본+상세 전체 구간을 우선. 줄바꿈으로 나뉜 상세주소도 원문에서 이어 잡는다.
  const addressSpan =
    findAddressSpanText(raw, order.address, order.addressDetail) ||
    findAddressSpanText(raw, parts.address, parts.addressDetail)
  if (addressSpan.length > (highlight.address?.length ?? 0)) {
    highlight.address = addressSpan
  }

  const productQuery = order.product.trim()
  const phoneRaw = order.phone.trim()
  const phone = normalizePhone(phoneRaw)
  const senderPhoneRaw = (order.senderPhone ?? '').trim()
  const senderPhone = normalizePhone(senderPhoneRaw)
  const fieldErrors: DraftOrder['fieldErrors'] = {}
  if (!(order.recipientName ?? '').trim()) {
    fieldErrors.recipientName = REQUIRED_FIELD_ERRORS.recipientName
  }
  if (!phoneRaw) {
    fieldErrors.phone = REQUIRED_FIELD_ERRORS.phone
  } else if (!phone) {
    fieldErrors.phone = '연락처 형식을 확인해 주세요.'
  }
  if (senderPhoneRaw && !senderPhone) {
    fieldErrors.senderPhone = '보내는분 연락처 형식을 확인해 주세요.'
  }

  const base = {
    id: newId(),
    recipientName: order.recipientName,
    phone: phone || phoneRaw,
    address: parts.address,
    addressDetail: parts.addressDetail,
    productQuery,
    quantity: order.quantity,
    senderName: (order.senderName ?? '').trim(),
    senderPhone: senderPhone || senderPhoneRaw,
    depositorName: order.depositorName,
    memo: order.memo,
    highlight,
    raw,
    blockStart,
    blockEnd,
    supplementSpans: order.supplementSpans,
    supplements,
    matches: buildMatches(raw, highlight),
    zonecode: '',
    addressChecking: true,
    addressCandidates: [],
    addressSearchQuery: '',
    addressEmptyQueries: [],
    fieldErrors,
  }
  return {
    ...base,
    ...resolveDraftProduct(base, productQuery || (highlight.product ?? ''), catalog),
  }
}

function buildHighlightNodes(text: string, ranges: TextRange[]) {
  const valid = ranges.filter(
    (range) => range.end > range.start && range.start >= 0 && range.end <= text.length,
  )
  if (valid.length === 0) {
    return text ? [<span key="t-0">{text}</span>] : []
  }

  // 겹치는 구간은 더 짧은(구체적) 범위 색을 쓴다. 병합으로 block이 겹쳐도 미리보기가 한 덩어리로 안 보이게.
  const bounds = new Set<number>([0, text.length])
  for (const range of valid) {
    bounds.add(range.start)
    bounds.add(range.end)
  }
  const points = [...bounds].sort((a, b) => a - b)
  const nodes: ReactNode[] = []

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i]
    const end = points[i + 1]
    if (end <= start) continue
    const slice = text.slice(start, end)
    const covering = valid
      .filter((range) => range.start <= start && range.end >= end)
      .sort(
        (a, b) => a.end - a.start - (b.end - b.start) || a.start - b.start,
      )
    const range = covering[0]
    if (!range) {
      nodes.push(<span key={`t-${start}`}>{slice}</span>)
      continue
    }
    if (range.interactive) {
      nodes.push(
        <button
          key={`h-${start}-${end}`}
          type="button"
          className={`rounded px-0.5 border-0 p-0 font-inherit align-baseline text-left ${range.className}`}
          title={range.title}
          onClick={range.onClick}
        >
          {slice}
        </button>,
      )
    } else {
      nodes.push(
        <mark
          key={`h-${start}-${end}`}
          className={`rounded px-0.5 ${range.className}`}
          title={range.title}
        >
          {slice}
        </mark>,
      )
    }
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

async function validateDraftAddress(draft: DraftOrder): Promise<DraftOrder> {
  const probeBase = draft.address.trim()
  const probeFull = (draft.highlight.address || [draft.address, draft.addressDetail].filter(Boolean).join(' ')).trim()
  const probe = probeBase || probeFull

  const emptyQueries: string[] = []
  const withAddressError = (
    message: string,
    extras?: { candidates?: EpostAddressResult[]; searchQuery?: string },
  ): DraftOrder => ({
    ...draft,
    zonecode: '',
    addressChecking: false,
    addressCandidates: extras?.candidates ?? [],
    addressSearchQuery: extras?.searchQuery ?? '',
    addressEmptyQueries: emptyQueries,
    fieldErrors: { ...draft.fieldErrors, address: message },
  })

  if (probe.length < 2) {
    return withAddressError('주소가 비어 있습니다.')
  }

  // 검색어는 원문 기본주소로만 만든다. 대체 검색어는 주소 수정 창에서 사용자가 고를 때만 쓴다.
  const queries = [buildEpostSearchQuery(probe), probeBase]
    .map((q) => q.replace(/\s+/g, ' ').trim())
    .filter((q, index, arr) => q.length >= 2 && arr.indexOf(q) === index)

  let lastCount = 0
  let lastError: string | null = null
  let mismatched: { candidates: EpostAddressResult[]; searchQuery: string } | null = null

  for (const query of queries) {
    try {
      const results = await searchEpostAddresses(query, { countPerPage: 20 })
      lastCount = results.length
      if (results.length === 0) emptyQueries.push(query)
      const unique = resolveUniqueEpostMatch(probeBase || probeFull, results)
        ?? resolveUniqueEpostMatch(probeFull, results)
      if (unique) {
        const resolved = applyAddressSelection(draft, unique, draft.addressDetail)
        const { problem } = await checkAddressDetail(resolved.address, resolved.addressDetail)
        if (!problem) return resolved
        // 기본주소는 확정됐고 동·호만 확인받는다. 수정 창에 이 후보를 그대로 띄운다.
        return {
          ...resolved,
          addressCandidates: [unique],
          addressSearchQuery: buildEpostSearchQuery(query) || query,
          fieldErrors: { ...resolved.fieldErrors, address: problem },
        }
      }
      // 다건이면 바로 수동 확인 — 다른 쿼리로 우연히 1건이 나와도 오확정 위험이 있어 중단.
      // 앞선 검색어에서 이미 1건 후보를 찾았으면 그 후보를 보여 준다.
      if (results.length > 1 && mismatched) break
      if (results.length > 1) {
        return withAddressError('주소가 여러 건 검색됩니다. 확인해 주세요.', {
          candidates: results,
          searchQuery: buildEpostSearchQuery(query) || query,
        })
      }
      if (results.length === 1 && !mismatched) {
        mismatched = { candidates: results, searchQuery: buildEpostSearchQuery(query) || query }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : '우체국 주소 조회에 실패했습니다.'
    }
  }

  // 검색은 됐지만 원문과 달라 자동 확정하지 않은 경우 — 후보를 보여 주고 확인받는다.
  if (mismatched) {
    const district = findDistrictMismatch(probe, mismatched.candidates[0])
    const message = district
      ? `확인 필요 · 원문은 ${district.original}인데 우체국 주소는 ${district.epost}입니다.`
      : '검색 결과가 원문 주소와 일치하지 않습니다. 확인해 주세요.'
    return withAddressError(message, mismatched)
  }
  if (lastError && lastCount === 0) {
    return withAddressError(lastError)
  }
  return withAddressError('우체국에서 검색되지 않는 주소입니다.')
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
  // 원본 메시지(raw)와 그 하이라이트는 그대로 둔다. 우체국 주소는 추출 결과에만 반영한다.
  return {
    ...draft,
    address: selected.roadAddress,
    addressDetail: detail,
    zonecode: selected.zipNo,
    addressChecking: false,
    addressCandidates: [],
    addressSearchQuery: '',
    addressEmptyQueries: [],
    fieldErrors: (() => {
      const next = { ...draft.fieldErrors }
      delete next.address
      return next
    })(),
  }
}

type TextFieldKey = Exclude<FieldKey, 'address' | 'product'>

function isTextFieldKey(key: FieldKey): key is TextFieldKey {
  return key !== 'address' && key !== 'product'
}

/** 별도 입금자명 → 보내는분 → 받는분 순. */
function resolveDepositorName(
  draft: Pick<DraftOrder, 'depositorName' | 'senderName' | 'recipientName'>,
): string {
  const explicit = draft.depositorName.trim()
  if (explicit) return explicit
  return draft.senderName.trim() || draft.recipientName.trim()
}

function getTextFieldValue(draft: DraftOrder, key: TextFieldKey): string {
  if (key === 'quantity') return String(draft.quantity)
  if (key === 'depositorName') return resolveDepositorName(draft)
  return draft[key]
}

/** 1줄: [우편번호] 기본주소 / 2줄: 상세주소 */
function AddressLabel({ draft }: { draft: DraftOrder }) {
  const base = draft.zonecode ? `[${draft.zonecode}] ${draft.address}` : draft.address
  const detail = draft.addressDetail.replace(/\s+/g, ' ').trim()
  return (
    <>
      <span className="block">{base}</span>
      {detail ? <span className="block">{detail}</span> : null}
    </>
  )
}

/** 주문 등록(createOrder)에 꼭 있어야 하는 텍스트 항목. 주소·상품은 각자 검증에서 처리한다. */
const REQUIRED_FIELD_ERRORS: Partial<Record<FieldKey, string>> = {
  recipientName: '수령인 이름이 비어 있습니다.',
  phone: '연락처가 비어 있습니다.',
}

/** 추출 결과 값만 바꾼다. 원본 메시지(raw)와 그 하이라이트는 건드리지 않는다. */
function applyTextFieldEdit(draft: DraftOrder, key: TextFieldKey, nextRaw: string): DraftOrder {
  const fieldErrors = { ...draft.fieldErrors }
  let nextValue = nextRaw.trim()

  if (key === 'quantity') {
    const qty = Math.max(1, Math.floor(Number(nextValue.replace(/[^\d]/g, ''))) || 1)
    delete fieldErrors.quantity
    return { ...draft, quantity: qty, fieldErrors }
  }

  const requiredError = REQUIRED_FIELD_ERRORS[key]
  if (requiredError && !nextValue) {
    fieldErrors[key] = requiredError
    return { ...draft, [key]: nextValue, fieldErrors }
  }

  if (key === 'phone' || key === 'senderPhone') {
    const normalized = normalizePhone(nextValue)
    if (nextValue && !normalized) {
      fieldErrors[key] =
        key === 'phone' ? '연락처 형식을 확인해 주세요.' : '보내는분 연락처 형식을 확인해 주세요.'
    } else {
      delete fieldErrors[key]
      nextValue = normalized
    }
  } else {
    delete fieldErrors[key]
  }

  return { ...draft, [key]: nextValue, fieldErrors }
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
    className: `rounded px-0.5 cursor-pointer ${isError ? FIELD_ERROR_CLASS : FIELD_META[key].className}`,
    title: isError ? `${errorMessage} — 눌러서 수정` : `${FIELD_META[key].label} — 눌러서 수정`,
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
  value: ReactNode
  fieldErrors: Partial<Record<FieldKey, string>>
  addressChecking: boolean
  onFixField: (key: FieldKey) => void
  className?: string
}) {
  const hi = fieldHighlightClass(fieldKey, fieldErrors, addressChecking)
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

function EmptyFieldButton({
  fieldKey,
  label,
  onFixField,
  errorMessage,
}: {
  fieldKey: FieldKey
  label: string
  onFixField: (key: FieldKey) => void
  errorMessage?: string
}) {
  return (
    <button
      type="button"
      title={`${errorMessage ?? FIELD_META[fieldKey].label} — 눌러서 입력`}
      onClick={() => onFixField(fieldKey)}
      className={
        errorMessage
          ? `rounded px-0.5 text-left ${FIELD_ERROR_CLASS}`
          : 'rounded px-0.5 text-left text-muted underline decoration-dotted underline-offset-2 hover:text-gray-700'
      }
    >
      {label}
    </button>
  )
}

function DraftOrderCard({
  draft,
  index,
  blockColorClass,
  products,
  onRemove,
  onFixField,
  onSelectProduct,
}: {
  draft: DraftOrder
  index: number
  blockColorClass: string
  products: Product[]
  onRemove: () => void
  onFixField: (key: FieldKey) => void
  onSelectProduct: (productId: string) => void
}) {
  const amount = draft.unitPrice * draft.quantity
  const errorEntries = (Object.keys(draft.fieldErrors) as FieldKey[]).filter(
    (key) => draft.fieldErrors[key],
  )
  const productError = Boolean(draft.fieldErrors.product)

  // 원본 메시지는 읽기 전용 하이라이트만. 수정은 오른쪽 추출 결과에서.
  const toFieldRanges = (matches: FieldMatch[]): TextRange[] =>
    matches.map((match) => {
      const errorMessage = draft.fieldErrors[match.key]
      const isError = Boolean(errorMessage) && !(match.key === 'address' && draft.addressChecking)
      return {
        start: match.start,
        end: match.end,
        className: isError ? FIELD_ERROR_CLASS : FIELD_META[match.key].className,
        title: isError ? errorMessage : FIELD_META[match.key].label,
      }
    })
  const fieldRanges = toFieldRanges(draft.matches)

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
          {draft.supplements.length > 0 ? (
            <>
              <p className="pt-1 text-xs font-medium text-muted">나중에 보낸 보완 메시지 (병합됨)</p>
              {draft.supplements.map((supplement, supplementIndex) => (
                <HighlightedText
                  key={supplementIndex}
                  text={supplement.text}
                  ranges={toFieldRanges(supplement.matches)}
                  className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-2.5"
                />
              ))}
            </>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 border-t border-gray-100 pt-3 lg:border-t-0 lg:pt-0 lg:pl-3">
          <p className="mb-2 text-xs font-medium text-muted">추출 결과 · 항목을 누르면 수정</p>
          <h4 className="font-semibold text-gray-900">
            {draft.recipientName ? (
              <DraftFieldMark fieldKey="recipientName" value={draft.recipientName} {...markProps} />
            ) : (
              <EmptyFieldButton
                fieldKey="recipientName"
                label="수령인 없음"
                onFixField={onFixField}
                errorMessage={draft.fieldErrors.recipientName}
              />
            )}
          </h4>
          {draft.address ? (
            <p className="mt-1 text-sm text-gray-700">
              <DraftFieldMark
                fieldKey="address"
                value={<AddressLabel draft={draft} />}
                className="inline-block"
                {...markProps}
              />
            </p>
          ) : (
            <p className="mt-1 text-sm">
              <EmptyFieldButton
                fieldKey="address"
                label="주소 없음"
                onFixField={onFixField}
                errorMessage={draft.addressChecking ? undefined : draft.fieldErrors.address}
              />
            </p>
          )}

          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-sm text-gray-700">
            {draft.phone ? (
              <>
                <a
                  href={`tel:${draft.phone.replace(/[^0-9+]/g, '')}`}
                  className="inline-flex items-center leading-none hover:text-primary"
                  aria-label="수령인에게 전화"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Phone className="h-3.5 w-3.5 shrink-0 text-muted" />
                </a>
                <DraftFieldMark fieldKey="phone" value={draft.phone} {...markProps} />
              </>
            ) : (
              <EmptyFieldButton
                fieldKey="phone"
                label="연락처 없음"
                onFixField={onFixField}
                errorMessage={draft.fieldErrors.phone}
              />
            )}
          </p>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted">
            <span>보내는 분 ·</span>
            {draft.senderName ? (
              <DraftFieldMark fieldKey="senderName" value={draft.senderName} {...markProps} />
            ) : (
              <EmptyFieldButton fieldKey="senderName" label="이름 없음" onFixField={onFixField} />
            )}
            <span>·</span>
            {draft.senderPhone ? (
              <>
                <a
                  href={`tel:${draft.senderPhone.replace(/[^0-9+]/g, '')}`}
                  className="inline-flex items-center leading-none hover:text-primary"
                  aria-label="보내는 분에게 전화"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Phone className="h-3 w-3 shrink-0 text-muted" />
                </a>
                <DraftFieldMark fieldKey="senderPhone" value={draft.senderPhone} {...markProps} />
              </>
            ) : (
              <EmptyFieldButton fieldKey="senderPhone" label="전화 없음" onFixField={onFixField} />
            )}
          </p>

          <p className="mt-0.5 text-xs text-muted">
            입금자 ·{' '}
            {resolveDepositorName(draft) ? (
              <DraftFieldMark
                fieldKey="depositorName"
                value={resolveDepositorName(draft)}
                {...markProps}
              />
            ) : (
              <EmptyFieldButton fieldKey="depositorName" label="없음" onFixField={onFixField} />
            )}
          </p>

          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-sm text-amber-900">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p>
              <span className="font-medium">요청사항</span>
              <span className="text-amber-700">
                {' '}
                ·{' '}
                {draft.memo ? (
                  <DraftFieldMark fieldKey="memo" value={draft.memo} {...markProps} />
                ) : (
                  <EmptyFieldButton fieldKey="memo" label="없음" onFixField={onFixField} />
                )}
              </span>
            </p>
          </div>

          <div className="mt-3 border-t border-gray-100 pt-2 space-y-2">
            <div>
              <p className="text-xs font-medium text-muted">상품</p>
              {products.length === 0 ? (
                <p className="mt-1 text-sm text-red-700">판매 중 상품이 없습니다.</p>
              ) : (
                <select
                  className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                    productError
                      ? 'border-red-400 bg-red-50 text-red-950'
                      : 'border-gray-200 bg-white text-gray-900'
                  }`}
                  value={draft.productId ?? ''}
                  onChange={(e) => {
                    if (e.target.value) onSelectProduct(e.target.value)
                  }}
                  aria-label="농가 상품 선택"
                >
                  <option value="">상품을 선택하세요</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} · {formatPrice(product.price)}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="text-sm text-gray-700">
              <span className="text-muted">
                수량{' '}
                <DraftFieldMark
                  fieldKey="quantity"
                  value={String(draft.quantity)}
                  {...markProps}
                />
              </span>
            </p>
            <p className="font-semibold text-primary">
              {draft.productId ? formatPrice(amount) : '—'}
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}

export function FarmOrderCreate() {
  const { farm, basePath } = useFarmWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
  const [messageText, setMessageText] = useState('')
  const [drafts, setDrafts] = useState<DraftOrder[]>([])
  const [parsedSource, setParsedSource] = useState('')
  const [ignoredSpans, setIgnoredSpans] = useState<Array<{ start: number; end: number }>>([])
  const [fixDraftId, setFixDraftId] = useState<string | null>(null)
  const [fixFieldKey, setFixFieldKey] = useState<FieldKey | null>(null)
  const [converting, setConverting] = useState(false)
  const [parseError, setParseError] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [productsLoaded, setProductsLoaded] = useState(false)

  // 들어올 때마다 비운다. 샘플 문구는 placeholder 로만 보여 준다.
  useEffect(() => {
    setMessageText('')
    setDrafts([])
    setParsedSource('')
    setIgnoredSpans([])
    setFixDraftId(null)
    setFixFieldKey(null)
    setConverting(false)
    setParseError('')
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('farm_id', farm.id)
        .order('sort_order')
      if (cancelled) return
      setProducts(((data as Product[]) ?? []).filter(isProductOrderable))
      setProductsLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [farm.id])

  const orderableProducts = useMemo(() => products.filter(isProductOrderable), [products])

  const countLabel = useMemo(() => `${drafts.length}건`, [drafts.length])
  const fixDraft = drafts.find((row) => row.id === fixDraftId) ?? null
  const errorCount = drafts.filter(
    (row) => !row.addressChecking && Object.keys(row.fieldErrors).length > 0,
  ).length

  const unmatchedOrderRanges = useMemo(
    () => findUnmatchedOrderRanges(parsedSource, drafts, ignoredSpans),
    [parsedSource, drafts, ignoredSpans],
  )

  const blockRanges: TextRange[] = useMemo(
    () => [
      ...drafts.flatMap((draft, index) => {
        const className = CARD_BLOCK_COLORS[index % CARD_BLOCK_COLORS.length]
        return [
          { start: draft.blockStart, end: draft.blockEnd, className, title: `주문 ${index + 1}` },
          ...draft.supplementSpans.map((span) => ({
            ...span,
            className,
            title: `주문 ${index + 1} 보완 (병합됨)`,
          })),
        ]
      }),
      ...unmatchedOrderRanges,
    ],
    [drafts, unmatchedOrderRanges],
  )

  useEffect(() => {
    let cancelled = false
    const pending = drafts.filter((row) => row.addressChecking)
    if (pending.length === 0) return

    void (async () => {
      const updates = await Promise.all(pending.map((draft) => validateDraftAddress(draft)))
      if (cancelled) return
      setDrafts((prev) =>
        prev.map((row) => {
          if (!row.addressChecking) return row
          const hit = updates.find((item) => item.id === row.id)
          return hit ?? { ...row, addressChecking: false }
        }),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [drafts])

  // 안드로이드 앱에서 카톡·문자 공유로 들어온 글은 바로 넣고 변환한다.
  // 상품 매칭에 카탈로그가 필요해 상품을 읽은 뒤 시작한다. 페이지에 있는 동안 새로 공유해도 location.key 가 바뀐다.
  useEffect(() => {
    if (!productsLoaded) return
    const shared = peekSharedOrderText()
    if (!shared.trim()) return
    clearSharedOrderText()
    setMessageText(shared)
    setDrafts([])
    setParsedSource('')
    void applyParse(shared)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 공유가 들어올 때만 실행
  }, [location.key, productsLoaded])

  async function applyParse(source = messageText) {
    if (converting) return
    const text = source.trim()
    if (text.length < 2) {
      setParseError('주문 메시지를 입력해 주세요.')
      return
    }

    setConverting(true)
    setParseError('')
    setFixDraftId(null)
    setFixFieldKey(null)
    try {
      const { orders, ignoredSpans: nextIgnored } = await parseOrderMessages(text)
      let drafts = orders.map((order) => toDraftOrder(order, text, orderableProducts))

      // 로컬 문자열/점수 매칭이 실패한 건만 카탈로그를 Claude에 넘겨 고른다.
      const unresolved = drafts
        .map((draft, index) => ({ draft, index }))
        .filter(({ draft }) => !draft.productId && draft.productQuery.trim())
      if (unresolved.length > 0 && orderableProducts.length > 0) {
        try {
          const productIds = await matchFarmProductsRemote(
            unresolved.map(({ draft }) => draft.productQuery),
            orderableProducts,
          )
          drafts = drafts.map((draft, index) => {
            const hit = unresolved.findIndex((row) => row.index === index)
            if (hit < 0) return draft
            const productId = productIds[hit]
            const product = productId
              ? orderableProducts.find((row) => row.id === productId)
              : null
            return product ? applyProductSelection(draft, product) : draft
          })
        } catch {
          // 파싱 결과는 유지. 상품만 수동 선택하면 된다.
        }
      }

      setDrafts(drafts)
      setIgnoredSpans(nextIgnored)
      setParsedSource(text)
    } catch (error) {
      setDrafts([])
      setIgnoredSpans([])
      setParsedSource('')
      setParseError(error instanceof Error ? error.message : '주문 메시지 변환에 실패했습니다.')
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

  function handleSelectProduct(draftId: string, productId: string) {
    const product = orderableProducts.find((row) => row.id === productId)
    if (!product) return
    setDrafts((prev) =>
      prev.map((row) => (row.id === draftId ? applyProductSelection(row, product) : row)),
    )
    if (fixDraftId === draftId && fixFieldKey === 'product') {
      setFixDraftId(null)
      setFixFieldKey(null)
    }
  }

  function handleSaveTextField(value: string) {
    if (!fixDraftId || !fixFieldKey || !isTextFieldKey(fixFieldKey)) return
    const key = fixFieldKey
    setDrafts((prev) =>
      prev.map((row) => (row.id === fixDraftId ? applyTextFieldEdit(row, key, value) : row)),
    )
    setFixDraftId(null)
    setFixFieldKey(null)
  }

  const textFixOpen =
    Boolean(fixDraft) && Boolean(fixFieldKey) && isTextFieldKey(fixFieldKey as FieldKey)

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
            onChange={(e) => {
              setMessageText(e.target.value)
              if (parseError) setParseError('')
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
              e.preventDefault()
              if (converting || messageText.trim().length < 2) return
              void applyParse()
            }}
            placeholder={PLACEHOLDER_MESSAGES}
          />
          <p className="text-xs text-muted">Enter 로 변환 · Shift+Enter 로 줄바꿈</p>
          {parseError ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{parseError}</p>
          ) : null}
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              type="button"
              size="sm"
              disabled={converting || messageText.trim().length < 2}
              onClick={() => void applyParse()}
            >
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
                  {unmatchedOrderRanges.length > 0 ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${UNMATCHED_ORDER_CLASS}`}
                    >
                      미연결 {unmatchedOrderRanges.length}
                    </span>
                  ) : null}
                </div>
              </div>
              {unmatchedOrderRanges.length > 0 ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                  주문처럼 보이지만 카드에 넣지 못한 문구가 {unmatchedOrderRanges.length}곳
                  있습니다.
                </p>
              ) : null}
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
              onClick={() => {
                setDrafts([])
                setIgnoredSpans([])
                setParsedSource('')
              }}
            >
              전체 비우기
            </button>
          )}
        </div>

        {errorCount > 0 ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
            확인이 필요한 항목이 {errorCount}건 있습니다. 추출 결과의 빨간 표시를 눌러 수정하세요.
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
                products={orderableProducts}
                onRemove={() => removeDraft(draft.id)}
                onFixField={(key) => openFieldFix(draft.id, key)}
                onSelectProduct={(productId) => handleSelectProduct(draft.id, productId)}
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
                  productId: draft.productId,
                  quantity: draft.quantity,
                  senderName: draft.senderName,
                  senderPhone: draft.senderPhone,
                  depositorName: resolveDepositorName(draft),
                  memo: draft.memo,
                  unitPrice: draft.unitPrice,
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
            ? fixDraft.highlight.address ||
              [fixDraft.address, fixDraft.addressDetail].filter(Boolean).join(', ')
            : ''
        }
        baseAddress={fixDraft?.address ?? ''}
        initialDetail={fixDraft?.addressDetail ?? ''}
        initialSearchQuery={fixDraft?.addressSearchQuery ?? ''}
        knownEmptyQueries={fixDraft?.addressEmptyQueries ?? []}
        initialResults={fixDraft?.addressCandidates ?? []}
        onClose={() => {
          setFixDraftId(null)
          setFixFieldKey(null)
        }}
        onSelect={handleSelectAddress}
      />

      <ProductPickDialog
        open={Boolean(fixDraft) && fixFieldKey === 'product'}
        query={fixDraft?.productQuery ?? ''}
        products={orderableProducts}
        selectedId={fixDraft?.productId ?? null}
        onClose={() => {
          setFixDraftId(null)
          setFixFieldKey(null)
        }}
        onSelect={(productId) => {
          if (!fixDraftId) return
          handleSelectProduct(fixDraftId, productId)
        }}
      />

      <FieldEditDialog
        open={textFixOpen}
        fieldKey={isTextFieldKey(fixFieldKey as FieldKey) ? (fixFieldKey as TextFieldKey) : 'recipientName'}
        initialValue={
          fixDraft && fixFieldKey && isTextFieldKey(fixFieldKey)
            ? getTextFieldValue(fixDraft, fixFieldKey)
            : ''
        }
        errorMessage={
          fixDraft && fixFieldKey && isTextFieldKey(fixFieldKey)
            ? fixDraft.fieldErrors[fixFieldKey]
            : undefined
        }
        onClose={() => {
          setFixDraftId(null)
          setFixFieldKey(null)
        }}
        onSave={handleSaveTextField}
      />
    </>
  )
}

function FieldEditDialog({
  open,
  fieldKey,
  initialValue,
  errorMessage,
  onClose,
  onSave,
}: {
  open: boolean
  fieldKey: TextFieldKey
  initialValue: string
  errorMessage?: string
  onClose: () => void
  onSave: (value: string) => void
}) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
  }, [open, initialValue])

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

  if (!open) return null

  const meta = FIELD_META[fieldKey]
  const isMemo = fieldKey === 'memo'
  const isPhone = fieldKey === 'phone' || fieldKey === 'senderPhone'
  const isQuantity = fieldKey === 'quantity'

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="닫기" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="field-edit-dialog-title"
        className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg"
      >
        <h2 id="field-edit-dialog-title" className="text-lg font-bold">
          {meta.label} 수정
        </h2>
        {errorMessage ? (
          <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage}</p>
        ) : (
          <p className="mt-2 text-sm text-muted">추출 결과 값을 직접 고칠 수 있습니다.</p>
        )}
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            onSave(value)
          }}
        >
          {isMemo ? (
            <Textarea
              label={meta.label}
              rows={4}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoFocus
            />
          ) : (
            <Input
              label={meta.label}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              inputMode={isPhone ? 'tel' : isQuantity ? 'numeric' : undefined}
              type={isQuantity ? 'number' : 'text'}
              min={isQuantity ? 1 : undefined}
              autoFocus
            />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" fullWidth onClick={onClose}>
              취소
            </Button>
            <Button type="submit" fullWidth>
              저장
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

function ProductPickDialog({
  open,
  query,
  products,
  selectedId,
  onClose,
  onSelect,
}: {
  open: boolean
  query: string
  products: Product[]
  selectedId: string | null
  onClose: () => void
  onSelect: (productId: string) => void
}) {
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

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-white pt-[env(safe-area-inset-top)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-3">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100"
          aria-label="닫기"
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="flex-1 text-base font-bold">상품 선택</h2>
      </div>
      <div className="space-y-3 border-b border-gray-50 px-4 py-3">
        <p className="text-sm text-muted">농가에 등록된 판매 중 상품만 고를 수 있습니다.</p>
        {query ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="text-xs font-medium text-red-800">메시지 원문</p>
            <p className="mt-1 break-words text-sm text-red-950">{query}</p>
          </div>
        ) : null}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {products.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted">판매 중 상품이 없습니다.</li>
        ) : (
          products.map((product) => {
            const active = product.id === selectedId
            return (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => onSelect(product.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left hover:bg-primary-light ${
                    active ? 'bg-primary-light' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{product.name}</span>
                    {product.unit ? (
                      <span className="mt-0.5 block text-xs text-muted">{product.unit}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-primary">
                    {formatPrice(product.price)}
                  </span>
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>,
    document.body,
  )
}
