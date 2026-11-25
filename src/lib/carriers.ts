/**
 * 송장 직접 등록에서 고르는 택배사. id 는 Delivery Tracker carrierId 이며
 * 서버 shared/delivery_tracker.py CARRIERS 와 같아야 한다.
 */
export const CARRIERS = [
  { id: 'kr.epost', name: '우체국택배' },
  { id: 'kr.cjlogistics', name: 'CJ대한통운' },
  { id: 'kr.hanjin', name: '한진택배' },
  { id: 'kr.coupangls', name: '쿠팡' },
] as const

export const CARRIER_NAME: Record<string, string> = Object.fromEntries(CARRIERS.map((c) => [c.id, c.name]))
