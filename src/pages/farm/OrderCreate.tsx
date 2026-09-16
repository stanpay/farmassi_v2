import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Phone, Trash2 } from 'lucide-react'
import { Header } from '../../components/layout/Header'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Textarea } from '../../components/ui/Field'
import { formatPrice } from '../../lib/format'
import { useFarmWorkspace } from '../../lib/farmWorkspace'

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
}

type TextRange = {
  start: number
  end: number
  className: string
  title?: string
}

/**
 * 더미 데이터.
 * raw = 카톡에서 그대로 긁어 온 것처럼 보이는 원문
 * 나머지 필드 = 카드에 보여줄 깔끔한 결과 (파서 없이 고정)
 */
const SAMPLE_ORDERS: CleanOrder[] = [
  {
    raw: `오후 4:19 초록빛농장 사장님 받는분:서울 마포구 월드컵북로12길8하늘아파트 101동1203호
이서준010-1111-2222
보내는분:박하은010-3333-4444`,
    recipientName: '이서준',
    phone: '010-1111-2222',
    address: '서울 마포구 월드컵북로12길 8 하늘아파트 101동 1203호',
    product: '포도즙',
    quantity: 1,
    depositorName: '박하은',
    memo: '',
    highlight: {
      recipientName: '이서준',
      phone: '010-1111-2222',
      address: '서울 마포구 월드컵북로12길8하늘아파트 101동1203호',
      depositorName: '박하은010-3333-4444',
    },
  },
  {
    raw: `오후 4:20 초록빛농장 사장님 받는분:경기 성남시 분당구 판교로245 
별빛마을 203동1102호 
최유진 010-5555-6666
보내는분:박하은 010-3333-4444
오후 4:21 초록빛농장 사장님 포도즙 하나씩 입니다.`,
    recipientName: '최유진',
    phone: '010-5555-6666',
    address: '경기 성남시 분당구 판교로 245 별빛마을 203동 1102호',
    product: '포도즙',
    quantity: 1,
    depositorName: '박하은',
    memo: '',
    highlight: {
      recipientName: '최유진',
      phone: '010-5555-6666',
      address: '경기 성남시 분당구 판교로245',
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
    address: '부산 해운대구 센텀중앙로 97 바다뷰APT 1502동 804호',
    product: '씨없는포도 3kg',
    quantity: 1,
    depositorName: '한도윤',
    memo: '',
    highlight: {
      recipientName: '한도윤',
      phone: '010-7777-8888',
      address: '부산 해운대구 센텀중앙로97',
      product: '씨없는 3kg',
    },
  },
]

/** 카톡 대화 통째로 붙여넣은 것처럼 보이게 구성 (전부 임의 더미) */
const SAMPLE_MESSAGES = `오후 4:19 초록빛농장 사장님 받는분:서울 마포구 월드컵북로12길8하늘아파트 101동1203호
이서준010-1111-2222
보내는분:박하은010-3333-4444
오후 4:20 초록빛농장 사장님 메시지가 삭제되었습니다.
오후 4:20 초록빛농장 사장님 받는분:경기 성남시 분당구 판교로245 
별빛마을 203동1102호 
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
  depositorName: { label: '입금자', className: 'bg-rose-200 text-rose-950' },
  memo: { label: '요청사항', className: 'bg-orange-200 text-orange-950' },
}

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

    return {
      id: newId(),
      recipientName: order.recipientName,
      phone: order.phone,
      address: order.address,
      product: order.product,
      quantity: order.quantity,
      depositorName: order.depositorName,
      memo: order.memo,
      highlight: order.highlight,
      raw,
      blockStart,
      blockEnd,
      matches: buildMatches(raw, order.highlight),
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
    nodes.push(
      <mark
        key={`h-${range.start}-${range.end}`}
        className={`rounded px-0.5 ${range.className}`}
        title={range.title}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    )
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
    </div>
  )
}

function DraftOrderCard({
  draft,
  index,
  blockColorClass,
  onRemove,
}: {
  draft: DraftOrder
  index: number
  blockColorClass: string
  onRemove: () => void
}) {
  const amount = DUMMY_UNIT_PRICE * draft.quantity

  const fieldRanges: TextRange[] = draft.matches.map((match) => ({
    start: match.start,
    end: match.end,
    className: FIELD_META[match.key].className,
    title: FIELD_META[match.key].label,
  }))

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold leading-none tabular-nums ${blockColorClass}`}
          >
            {index + 1}
          </span>
          <p className="text-xs text-muted">DRAFT-{String(index + 1).padStart(3, '0')}</p>
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

      <div className="mt-3 space-y-2">
        <p className="text-xs font-medium text-muted">원본 메시지</p>
        <HighlightedText
          text={draft.raw}
          ranges={fieldRanges}
          className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5"
        />
        <FieldLegend />
      </div>

      <div className="mt-3 border-t border-gray-100 pt-3">
        <h4 className="font-semibold text-gray-900">{draft.recipientName}</h4>
        <p className="mt-1 text-sm text-gray-700">
          {draft.product} <span className="text-muted">· 수량 {draft.quantity}</span>
        </p>
        {draft.address ? <p className="mt-0.5 text-sm text-muted">{draft.address}</p> : null}

        {draft.phone ? (
          <a
            href={`tel:${draft.phone.replace(/[^0-9+]/g, '')}`}
            className="mt-0.5 inline-flex items-center gap-1 text-sm text-muted hover:text-primary"
          >
            <Phone className="h-3.5 w-3.5 shrink-0" />
            {draft.phone}
          </a>
        ) : null}

        {draft.depositorName && draft.depositorName !== draft.recipientName ? (
          <p className="mt-0.5 text-xs text-muted">보내는 분 · {draft.depositorName}</p>
        ) : null}

        {draft.memo ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-sm text-amber-900">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p>
              <span className="font-medium">요청사항</span>
              <span className="text-amber-700"> · {draft.memo}</span>
            </p>
          </div>
        ) : null}

        <div className="mt-2">
          <span className="font-semibold text-primary">{formatPrice(amount)}</span>
        </div>
      </div>
    </Card>
  )
}

export function FarmOrderCreate() {
  const { farm, basePath } = useFarmWorkspace()
  const navigate = useNavigate()
  const [messageText, setMessageText] = useState(SAMPLE_MESSAGES)
  const [drafts, setDrafts] = useState<DraftOrder[]>(() => buildDrafts(SAMPLE_MESSAGES))
  const [parsedSource, setParsedSource] = useState(SAMPLE_MESSAGES)

  const countLabel = useMemo(() => `${drafts.length}건`, [drafts.length])

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

  function applyParse() {
    setDrafts(buildDrafts(messageText))
    setParsedSource(messageText)
  }

  function removeDraft(id: string) {
    setDrafts((prev) => prev.filter((row) => row.id !== id))
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
            placeholder={SAMPLE_MESSAGES}
          />
          <div className="flex flex-wrap gap-2 justify-end">
            <Button type="button" size="sm" onClick={applyParse}>
              카드로 변환
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
          <h2 className="text-sm font-semibold text-gray-900">주문 카드 · {countLabel}</h2>
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
              />
            ))
          )}
        </div>

        <div className="flex gap-2 justify-end pb-4">
          <Button type="button" variant="outline" onClick={() => navigate(`${basePath}/orders`)}>
            취소
          </Button>
          <Button type="button" disabled={drafts.length === 0}>
            {drafts.length > 0 ? `${drafts.length}건 주문 추가` : '주문 추가'}
          </Button>
        </div>
      </div>
    </>
  )
}
