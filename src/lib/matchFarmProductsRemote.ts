import { isDevAuthBypass } from './devAuthBypass'
import { invokeFunction } from './functions'
import type { Product } from '../types/models'
import { isProductOrderable } from '../types/models'

async function matchFarmProductsDev(
  queries: string[],
  products: Array<{ id: string; name: string }>,
): Promise<Array<string | null>> {
  const response = await fetch('/__dev/match-farm-products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries, products }),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    productIds?: Array<string | null>
    error?: string
  }
  if (!response.ok) {
    throw new Error(payload.error || `상품 매칭 실패 (${response.status})`)
  }
  return payload.productIds ?? queries.map(() => null)
}

/** 로컬 매칭이 실패한 문구만 Claude 카탈로그 매칭으로 넘긴다. */
export async function matchFarmProductsRemote(
  queries: string[],
  products: Product[],
): Promise<Array<string | null>> {
  const catalog = products
    .filter((row) => isProductOrderable(row))
    .map((row) => ({ id: row.id, name: row.name }))
  if (queries.length === 0) return []
  if (catalog.length === 0) return queries.map(() => null)

  if (isDevAuthBypass()) {
    return matchFarmProductsDev(queries, catalog)
  }
  const data = await invokeFunction<{ productIds?: Array<string | null> }>('match-farm-products', {
    queries,
    products: catalog,
  })
  return data.productIds ?? queries.map(() => null)
}
