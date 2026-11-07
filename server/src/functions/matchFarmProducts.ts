import { fail, ok, type FnHandler } from './types.ts'

const MODEL = 'claude-sonnet-5-5'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

const SYSTEM_PROMPT = `당신은 농가 상품 카탈로그 매칭기다. JSON만 출력한다.

규칙:
- catalog 에 있는 상품만 고른다. 새 이름을 만들지 않는다.
- 고객 문구의 무게(kg/키로)가 있으면 카탈로그 상품 무게와 같아야 한다.
- 품종 통칭·별칭은 허용한다. 예: "포도" ↔ 캠벨/거봉/샤인머스켓, "사과" ↔ 부사/홍로.
- 즙·주스 요청은 즙·주스 상품에만, 생과는 생과에만 연결한다.
- 확신이 없거나 후보가 여러 개로 갈리면 productId 를 null 로 둔다.
- 입력 queries 순서와 같은 길이의 matches 배열을 반환한다.

출력 JSON:
{
  "matches": [
    { "query": string, "productId": string | null }
  ]
}`

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
  if (start < 0 || end < start) throw new Error('상품 매칭 응답이 JSON이 아닙니다.')
  return JSON.parse(candidate.slice(start, end + 1))
}

export type CatalogProduct = { id: string; name: string }

export async function matchFarmProductsWithClaude(
  queries: string[],
  catalog: CatalogProduct[],
): Promise<Array<string | null>> {
  const cleanedQueries = queries.map((q) => q.trim())
  if (cleanedQueries.length === 0) return []
  if (catalog.length === 0) return cleanedQueries.map(() => null)

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `catalog:\n${JSON.stringify(catalog, null, 2)}\n\n` +
            `queries:\n${JSON.stringify(cleanedQueries, null, 2)}\n\n` +
            `각 query 에 맞는 catalog.id 를 골라 JSON으로만 답하세요.`,
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

  const parsed = extractJson(textOut) as { matches?: unknown }
  const list = Array.isArray(parsed.matches) ? parsed.matches : []
  const byQuery = new Map<string, string | null>()
  const allowed = new Set(catalog.map((row) => row.id))

  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as { query?: unknown; productId?: unknown }
    const query = typeof row.query === 'string' ? row.query.trim() : ''
    const productId = typeof row.productId === 'string' ? row.productId : null
    if (!query) continue
    byQuery.set(query, productId && allowed.has(productId) ? productId : null)
  }

  return cleanedQueries.map((query, index) => {
    if (byQuery.has(query)) return byQuery.get(query) ?? null
    const row = list[index] as { productId?: unknown } | undefined
    const productId = typeof row?.productId === 'string' ? row.productId : null
    return productId && allowed.has(productId) ? productId : null
  })
}

export const matchFarmProducts: FnHandler = async (ctx) => {
  if (!ctx.userId) return fail('로그인이 필요합니다.', 401)
  try {
    const queries = Array.isArray(ctx.body?.queries)
      ? ctx.body.queries.map((item: unknown) => String(item ?? ''))
      : []
    const catalog = Array.isArray(ctx.body?.products)
      ? ctx.body.products
          .map((item: any) => ({
            id: String(item?.id ?? ''),
            name: String(item?.name ?? ''),
          }))
          .filter((row: CatalogProduct) => row.id && row.name)
      : []
    if (queries.length === 0) return fail('queries 가 필요합니다.')
    const productIds = await matchFarmProductsWithClaude(queries, catalog)
    return ok({ productIds })
  } catch (error) {
    return fail(error instanceof Error ? error.message : '상품 매칭에 실패했습니다.', 500)
  }
}
