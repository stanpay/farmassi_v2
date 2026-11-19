import { isDevAuthBypass } from './devAuthBypass'
import { invokeFunction } from './functions'
import { normalizeParsedOrders, type TextSpan } from './normalizeParsedOrders'

export type ParsedOrderHighlight = Partial<{
  recipientName: string
  phone: string
  address: string
  product: string
  quantity: string
  senderName: string
  senderPhone: string
  depositorName: string
  memo: string
}>

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
  highlight: ParsedOrderHighlight
  /** Claude 가 이 주문에 병합한 보완 말풍선 원문 */
  supplements?: string[]
  /** supplements 의 원문 위치 */
  supplementSpans: TextSpan[]
}

type ParseResponse = {
  orders?: Array<Omit<ParsedOrderMessage, 'supplementSpans'>>
  ignored?: string[]
  error?: string
}

async function parseOrderMessagesDev(text: string): Promise<ParseResponse> {
  const response = await fetch('/__dev/parse-order-messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  const payload = (await response.json().catch(() => ({}))) as ParseResponse
  if (!response.ok) {
    throw new Error(payload.error || `주문 메시지 파싱 실패 (${response.status})`)
  }
  return payload
}

export async function parseOrderMessages(text: string): Promise<{
  orders: ParsedOrderMessage[]
  ignoredSpans: TextSpan[]
}> {
  const payload = isDevAuthBypass()
    ? await parseOrderMessagesDev(text)
    : await invokeFunction<ParseResponse>('parse-order-messages', { text })
  return normalizeParsedOrders(text, payload.orders ?? [], payload.ignored ?? [])
}
