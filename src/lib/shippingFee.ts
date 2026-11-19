/**
 * 배송비 계산 (화면용).
 *
 * 서버 shared/shipping_fee.py 와 같은 규칙이다. 주문 전에 손님에게 보여줄
 * 금액을 미리 계산하려면 화면에도 같은 계산이 있어야 한다. 실제 청구는
 * 서버가 다시 계산하므로 여기 값이 틀려도 금액이 잘못 나가지는 않는다.
 */
export interface ShippingTier {
  qty: number
  fee: number
}

export function normalizeTiers(raw: unknown): ShippingTier[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const qty = Number((item as any).qty)
      const fee = Number((item as any).fee)
      if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(fee) || fee < 0) return null
      return { qty, fee: Math.round(fee) }
    })
    .filter((t): t is ShippingTier => t !== null)
    .sort((a, b) => a.qty - b.qty)
}

/**
 * 이 수량의 배송비. qty 는 '이 수량까지' 를 뜻한다.
 *
 * 표에 없는 큰 수량은 마지막 구간을 되풀이한다. 3box 까지만 정해 뒀는데
 * 7box 를 시키면 3box 묶음 세 번으로 본다.
 * 표가 비어 있으면 0 — 상품가에 포함된 것으로 본다.
 */
export function shippingFeeFor(raw: unknown, quantity: number): number {
  const tiers = normalizeTiers(raw)
  if (tiers.length === 0 || quantity <= 0) return 0
  for (const tier of tiers) if (quantity <= tier.qty) return tier.fee
  const last = tiers[tiers.length - 1]
  return last.fee * Math.ceil(quantity / last.qty)
}
