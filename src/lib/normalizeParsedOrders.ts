/**
 * Claude 파싱 결과의 위치 정규화만 한다.
 * 분리·병합·무시는 맥락 판단이 필요해 Claude 가 결정하고, 여기서는 바꾸지 않는다.
 * 같은 문장이 원문에 여러 번 있으면(주소 재전송 등) 아직 쓰이지 않은 위치로 맞춘다.
 */

export type TextSpan = { start: number; end: number }

type PositionedOrder = {
  raw: string
  blockStart: number | null
  blockEnd: number | null
  supplements?: string[]
}

export type NormalizedOrder<T extends PositionedOrder> = T & { supplementSpans: TextSpan[] }

export type NormalizedParseResult<T extends PositionedOrder> = {
  orders: Array<NormalizedOrder<T>>
  ignoredSpans: TextSpan[]
}

function overlapsAny(spans: TextSpan[], start: number, end: number) {
  return spans.some((span) => start < span.end && span.start < end)
}

/** needle 이 나오는 위치 중 used 와 겹치지 않는 첫 위치. 모두 겹치면 첫 위치. */
function locateUnused(source: string, needle: string, used: TextSpan[]): TextSpan | null {
  if (!needle) return null
  let first: TextSpan | null = null
  for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + 1)) {
    const span = { start: at, end: at + needle.length }
    if (!first) first = span
    if (!overlapsAny(used, span.start, span.end)) return span
  }
  return first
}

export function normalizeParsedOrders<T extends PositionedOrder>(
  source: string,
  orders: T[],
  ignored: string[] = [],
): NormalizedParseResult<T> {
  const used: TextSpan[] = []

  const positioned = orders.map((order) => {
    let { blockStart, blockEnd } = order
    const valid = blockStart != null && blockEnd != null && blockEnd > blockStart
    if (!valid || overlapsAny(used, blockStart!, blockEnd!)) {
      const span = locateUnused(source, order.raw, used)
      if (span) {
        blockStart = span.start
        blockEnd = span.end
      }
    }
    if (blockStart != null && blockEnd != null && blockEnd > blockStart) {
      used.push({ start: blockStart, end: blockEnd })
    }
    return { ...order, blockStart, blockEnd }
  })

  const normalized = positioned.map((order) => {
    const supplementSpans: TextSpan[] = []
    for (const text of order.supplements ?? []) {
      const span = locateUnused(source, text, used)
      if (!span) continue
      supplementSpans.push(span)
      used.push(span)
    }
    return { ...order, supplementSpans }
  })

  const ignoredSpans: TextSpan[] = []
  for (const text of ignored) {
    const span = locateUnused(source, text, used)
    if (!span) continue
    ignoredSpans.push(span)
    used.push(span)
  }

  return { orders: normalized, ignoredSpans }
}
