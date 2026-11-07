import { fail, ok, type FnHandler } from './types.ts'

const MODEL = 'claude-sonnet-5-5'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

const SYSTEM_PROMPT = `당신은 한국 카카오톡 주문 대화에서 주문을 찾아 JSON으로만 표시하는 파서다.
문자를 다시 쓰지 않는다. 모든 문자열은 원문 부분문자열이다.

규칙 (분리·병합·무시는 정해진 패턴이 아니라 대화 맥락으로 판단한다):
- 주문: 받는 사람이나 배송지를 알 수 있는 내용이 주문이다. 받는 사람이나 배송지가 다르면 다른 주문이다.
  같은 주소라도 받는 사람·상품이 다르면 다른 주문일 수 있다.
- 한 말풍선에 이름·전화·주소가 여러 줄로 이어지면 그 전체가 한 주문이다. raw 는 그 말풍선 본문 전체.
- 내용이 부족한 조각(상품·수량·전화·보내는분 등만 있고 혼자서는 주문이 안 되는 것)은 먼저 미연결로 본다.
  한 말풍선에 여러 조각이 섞여 있으면 조각별로 나눠서 판단한다.
- 병합: 미연결 조각이 기존 주문과 겹치는 단서(지역·주소 일부·이름·전화·상품 등, 오타·약칭 포함. 예: 노윈구=노원구)가 있으면
  그 주문의 보완이다. 그 주문의 빈 필드를 채우고, 조각 원문을 그 주문의 supplements 에 넣는다.
  그 주문에 이미 같은 내용이 있어도 그 주문을 가리키는 조각이면 supplements 에 넣는다.
- 겹치는 주문이 없는 조각은 새 주문으로 만들지 않고 orders·supplements·ignored 어디에도 넣지 않는다(화면에 미연결로 표시된다).
- 무시: 이미 보낸 주문 내용을 그대로 다시 보낸 재전송, 대화 상대 닉네임처럼 주문이 아닌 문구는 ignored 에 원문 구간을 넣는다.
  같은 주소라도 새 정보가 있으면 무시하지 말고 병합하거나 별도 주문으로 둔다.
- raw·supplements·ignored 구간끼리 겹치지 않게.
- 카톡 시간·닉네임·"메시지가 삭제되었습니다"는 필드로 쓰지 않는다.
- phone/address/addressDetail/이름은 원문 그대로. 포맷을 바꾸지 말 것.
- recipientName/phone=받는분, senderName/senderPhone=보내는분, depositorName=입금자.
- quantity만 숫자(불명=1). 없으면 빈 문자열.
- highlight.* 도 원문 부분문자열(본문이나 supplements 안). highlight.quantity 는 수량을 나타내는 원문 문구 그대로(예: "2박스", "한박스", "하나", "1개").

출력 JSON:
{
  "orders": [
    {
      "raw": string,
      "blockStart": number | null,
      "blockEnd": number | null,
      "recipientName": string,
      "phone": string,
      "address": string,
      "addressDetail": string,
      "product": string,
      "quantity": number,
      "senderName": string,
      "senderPhone": string,
      "depositorName": string,
      "memo": string,
      "highlight": {
        "recipientName"?: string,
        "phone"?: string,
        "address"?: string,
        "product"?: string,
        "quantity"?: string,
        "senderName"?: string,
        "senderPhone"?: string,
        "depositorName"?: string,
        "memo"?: string
      },
      "supplements": string[]
    }
  ],
  "ignored": string[]
}`

export type ParsedOrderMessage = {
  raw: string
  blockStart: number | null
  blockEnd: number | null
  recipientName: string
  phone: string
  address: string
  addressDetail: string
  product: string
  quantity: number
  senderName: string
  senderPhone: string
  depositorName: string
  memo: string
  highlight: Record<string, string>
  /** 나중에 보낸 보완 말풍선 원문 — Claude 가 이 주문에 병합한 구간 */
  supplements: string[]
}

export type ParsedOrderMessagesResult = {
  orders: ParsedOrderMessage[]
  /** 재전송 등 Claude 가 무시한 원문 구간 */
  ignored: string[]
}

function recoverSlices(source: string, value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => recoverExactSlice(source, asString(item)))
    .filter((item) => item.length > 0)
}

const FIELD_KEYS = [
  'recipientName',
  'phone',
  'address',
  'addressDetail',
  'product',
  'senderName',
  'senderPhone',
  'depositorName',
  'memo',
] as const

const HIGHLIGHT_KEYS = [
  'recipientName',
  'phone',
  'address',
  'product',
  'quantity',
  'senderName',
  'senderPhone',
  'depositorName',
  'memo',
] as const

function apiKey() {
  const raw = (process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (!raw) throw new Error('Claude API 키(ANTHROPIC_API_KEY)가 설정되지 않았습니다.')
  return raw
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1].trim() : trimmed
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('주문 파싱 응답이 JSON이 아닙니다.')
  return JSON.parse(candidate.slice(start, end + 1))
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function asNullableInt(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/** 공백을 무시하고 haystack 에서 needle 에 해당하는 원문 구간을 그대로 돌려준다. */
function recoverExactSlice(haystack: string, needle: string): string {
  const trimmed = needle.trim()
  if (!trimmed || !haystack) return ''
  if (haystack.includes(trimmed)) return trimmed

  const compactNeedle = trimmed.replace(/\s+/g, '')
  if (!compactNeedle) return ''

  let compactPos = 0
  const compactIndex: number[] = []
  for (let i = 0; i < haystack.length; i++) {
    if (/\s/.test(haystack[i])) continue
    compactIndex[compactPos] = i
    compactPos++
  }
  const compactHay = haystack.replace(/\s+/g, '')
  const at = compactHay.indexOf(compactNeedle)
  if (at < 0) return ''

  const start = compactIndex[at]
  const endExclusive = compactIndex[at + compactNeedle.length - 1] + 1
  return haystack.slice(start, endExclusive)
}

function nearestIndexOf(source: string, needle: string, hint: number | null): number {
  let best = -1
  for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + 1)) {
    if (best < 0 || (hint != null && Math.abs(at - hint) < Math.abs(best - hint))) best = at
  }
  return best
}

function resolveRaw(source: string, row: Record<string, unknown>): {
  raw: string
  blockStart: number | null
  blockEnd: number | null
} | null {
  const blockStart = asNullableInt(row.blockStart)
  const blockEnd = asNullableInt(row.blockEnd)

  // Claude 가 센 문자 위치는 자주 어긋나므로 raw 문자열을 원문에서 찾는 것을 우선한다.
  const recovered = recoverExactSlice(source, asString(row.raw))
  const found = recovered ? nearestIndexOf(source, recovered, blockStart) : -1
  if (found >= 0) {
    return { raw: recovered, blockStart: found, blockEnd: found + recovered.length }
  }

  if (
    blockStart != null &&
    blockEnd != null &&
    blockStart >= 0 &&
    blockEnd > blockStart &&
    blockEnd <= source.length
  ) {
    return {
      raw: source.slice(blockStart, blockEnd),
      blockStart,
      blockEnd,
    }
  }
  return null
}

function normalizeOrder(rawOrder: unknown, source: string): ParsedOrderMessage | null {
  if (!rawOrder || typeof rawOrder !== 'object') return null
  const row = rawOrder as Record<string, unknown>
  const resolved = resolveRaw(source, row)
  if (!resolved) return null
  const { raw, blockStart, blockEnd } = resolved

  const fields: Record<(typeof FIELD_KEYS)[number], string> = {
    recipientName: '',
    phone: '',
    address: '',
    addressDetail: '',
    product: '',
    senderName: '',
    senderPhone: '',
    depositorName: '',
    memo: '',
  }
  for (const key of FIELD_KEYS) {
    fields[key] = recoverExactSlice(raw, asString(row[key])) || recoverExactSlice(source, asString(row[key]))
  }

  const highlightIn =
    row.highlight && typeof row.highlight === 'object'
      ? (row.highlight as Record<string, unknown>)
      : {}
  // 병합된 보완 말풍선에만 있는 값(예: 수량 "2박스")도 하이라이트로 남긴다.
  const supplements = recoverSlices(source, row.supplements)
  const highlightScope = [raw, ...supplements]
  const highlight: Record<string, string> = {}
  for (const key of HIGHLIGHT_KEYS) {
    const claimed = asString(highlightIn[key])
    const recovered =
      highlightScope.map((text) => recoverExactSlice(text, claimed)).find(Boolean) ||
      (key in fields ? fields[key as (typeof FIELD_KEYS)[number]] : '')
    if (recovered && highlightScope.some((text) => text.includes(recovered))) {
      highlight[key] = recovered
    }
  }

  // 주소 하이라이트가 없으면 기본+상세를 원문에서 이어 붙인 구간이 있을 때만 채운다.
  if (!highlight.address) {
    const combined = [fields.address, fields.addressDetail].filter(Boolean).join(' ')
    const recoveredCombined = recoverExactSlice(raw, combined)
    if (recoveredCombined) highlight.address = recoveredCombined
    else if (fields.address && raw.includes(fields.address)) highlight.address = fields.address
  }

  const quantityRaw = Number(row.quantity)
  const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.trunc(quantityRaw) : 1

  return {
    raw,
    blockStart,
    blockEnd,
    recipientName: fields.recipientName,
    phone: fields.phone,
    address: fields.address,
    addressDetail: fields.addressDetail,
    product: fields.product,
    quantity,
    senderName: fields.senderName,
    senderPhone: fields.senderPhone,
    depositorName: fields.depositorName,
    memo: fields.memo,
    highlight,
    supplements,
  }
}

export async function parseOrderMessagesText(text: string): Promise<ParsedOrderMessagesResult> {
  const source = text // trim 하지 않음 — 인덱스가 원문과 어긋나지 않게
  if (source.trim().length < 2) throw new Error('주문 메시지를 입력해 주세요.')

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `다음 카톡 원문에서 주문을 JSON으로만 표시하세요. 분리·병합·무시는 대화 맥락으로 판단하고, 문자를 다시 쓰지 마세요.\n\n---\n${source}\n---`,
        },
      ],
    }),
  })

  const payload = (await response.json().catch(() => ({}))) as {
    content?: Array<{ type?: string; text?: string }>
    error?: { message?: string }
  }
  if (!response.ok) {
    throw new Error(payload.error?.message || `Claude API 오류 (HTTP ${response.status})`)
  }

  const textOut = (payload.content ?? [])
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n')
  if (!textOut.trim()) throw new Error('Claude 응답이 비어 있습니다.')

  const parsed = extractJson(textOut) as { orders?: unknown; ignored?: unknown }
  const list = Array.isArray(parsed.orders) ? parsed.orders : []
  const orders = list
    .map((item) => normalizeOrder(item, source))
    .filter((item): item is ParsedOrderMessage => Boolean(item))

  if (orders.length === 0) throw new Error('추출된 주문이 없습니다.')
  return { orders, ignored: recoverSlices(source, parsed.ignored) }
}

export const parseOrderMessages: FnHandler = async (ctx) => {
  if (!ctx.userId) return fail('로그인이 필요합니다.', 401)
  try {
    const text = String(ctx.body?.text ?? '')
    return ok(await parseOrderMessagesText(text))
  } catch (error) {
    return fail(error instanceof Error ? error.message : '주문 메시지 파싱에 실패했습니다.', 500)
  }
}
