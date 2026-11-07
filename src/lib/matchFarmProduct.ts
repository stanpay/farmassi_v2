import type { Product } from '../types/models'
import { isProductOrderable } from '../types/models'

function compact(value: string) {
  return value.replace(/\s+/g, '').toLowerCase()
}

/** 품종·통칭이 같은 묶음. 쿼리/상품명이 같은 묶음에 있으면 동의어로 본다. */
const VARIETY_GROUPS: string[][] = [
  ['포도', '캠벨', '거봉', '샤인', '샤인머스켓', '머스켓', '델라웨어', '흑포도', '청포도', '씨없는포도', '못난이포도'],
  ['사과', '부사', '홍로', '아오리', '감홍', '시나노', '시나노골드', '양광', '쓰가루'],
  ['배', '신고', '원황', '황금배', '추황'],
  ['감', '대봉', '반시', '곶감', '단감'],
  ['귤', '감귤', '한라봉', '천혜향', '레드향', '황금향'],
  ['토마토', '방울토마토', '대추방울'],
  ['딸기', '설향', '금실', '킹스베리'],
]

const WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(kg|㎏|키로)/gi

export type FarmProductMatch = {
  product: Product
  kind: 'exact' | 'contains' | 'scored'
}

function normalizeWeightToken(raw: string) {
  return raw.replace(/\s+/g, '').toLowerCase().replace('㎏', 'kg').replace('키로', 'kg')
}

function extractWeights(value: string): string[] {
  const hits: string[] = []
  const re = new RegExp(WEIGHT_RE.source, WEIGHT_RE.flags)
  let match: RegExpExecArray | null
  while ((match = re.exec(value))) {
    hits.push(normalizeWeightToken(`${match[1]}kg`))
  }
  return hits
}

function stripWeights(value: string) {
  return value.replace(WEIGHT_RE, ' ').replace(/\s+/g, ' ').trim()
}

function tokensOf(value: string): string[] {
  const compactValue = compact(stripWeights(value))
  if (!compactValue) return []
  const parts = compactValue.split(/[^0-9a-z가-힣]+/).filter(Boolean)
  return parts.length > 0 ? parts : [compactValue]
}

function varietyGroupIndex(token: string): number {
  const t = token.toLowerCase()
  return VARIETY_GROUPS.findIndex((group) => group.some((item) => t === item || t.includes(item) || item.includes(t)))
}

function relatedTokens(a: string, b: string) {
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true
  const ga = varietyGroupIndex(a)
  const gb = varietyGroupIndex(b)
  return ga >= 0 && ga === gb
}

function scoreProduct(query: string, productName: string): number {
  const qCompact = compact(query)
  const nCompact = compact(productName)
  if (!qCompact || !nCompact) return 0

  const qWeights = extractWeights(query)
  const nWeights = extractWeights(productName)
  if (qWeights.length > 0 && nWeights.length > 0) {
    const overlap = qWeights.some((w) => nWeights.includes(w))
    if (!overlap) return 0
  }

  // 즙·주스 등은 생과와 섞지 않는다.
  const qJuice = /즙|주스|juice/.test(qCompact)
  const nJuice = /즙|주스|juice/.test(nCompact)
  if (qJuice !== nJuice) return 0

  let score = 0
  if (qWeights.length > 0 && nWeights.some((w) => qWeights.includes(w))) score += 4

  const qTokens = tokensOf(query)
  const nTokens = tokensOf(productName)
  let related = 0
  for (const qt of qTokens) {
    if (nTokens.some((nt) => relatedTokens(qt, nt))) related += 1
  }
  if (related === 0 && qTokens.length > 0) {
    // 무게만 맞고 품목 단서가 전혀 없으면 약한 후보로만 둔다.
    return qWeights.length > 0 && nWeights.length > 0 ? score : 0
  }
  score += related * 3

  if (nCompact.includes(qCompact) || qCompact.includes(nCompact)) score += 2
  return score
}

/**
 * 카톡에서 뽑은 상품 문구를 농가 상품 목록과 맞춘다.
 * 정확히 1건으로 좁혀질 때만 반환. 0건·다건은 null.
 */
export function matchFarmProduct(
  query: string,
  products: Product[],
): FarmProductMatch | null {
  const q = query.trim()
  if (!q) return null

  const catalog = products.filter((row) => isProductOrderable(row))
  if (catalog.length === 0) return null

  const qCompact = compact(q)

  const exact = catalog.filter((row) => row.name.trim() === q || compact(row.name) === qCompact)
  if (exact.length === 1) return { product: exact[0], kind: 'exact' }
  if (exact.length > 1) return null

  const contains = catalog.filter((row) => {
    const name = compact(row.name)
    if (!name || !qCompact) return false
    return name.includes(qCompact) || qCompact.includes(name)
  })
  if (contains.length === 1) return { product: contains[0], kind: 'contains' }
  if (contains.length > 1) {
    // 부분일치가 여러 개면 점수로 한 번 더 가린다.
    const ranked = contains
      .map((product) => ({ product, score: scoreProduct(q, product.name) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
    if (ranked.length === 1) return { product: ranked[0].product, kind: 'scored' }
    if (ranked.length > 1 && ranked[0].score > ranked[1].score) {
      return { product: ranked[0].product, kind: 'scored' }
    }
    return null
  }

  const ranked = catalog
    .map((product) => ({ product, score: scoreProduct(q, product.name) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)

  if (ranked.length === 0) return null
  if (ranked.length === 1) return { product: ranked[0].product, kind: 'scored' }
  if (ranked[0].score > ranked[1].score) return { product: ranked[0].product, kind: 'scored' }
  return null
}
