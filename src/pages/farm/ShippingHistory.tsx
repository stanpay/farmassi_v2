import { useMemo } from 'react'
import { ShippingHistoryContent } from '../admin/ShippingHistory'
import { useFarmWorkspace } from '../../lib/farmWorkspace'
import type { HistoryFarm } from '../../lib/shippingHistory'

/** 관리자 배송이력과 동일 UI. 현재 농가 한 곳만 보인다. */
export function FarmShippingHistory() {
  const { farm, basePath } = useFarmWorkspace()
  const scopedFarm = useMemo<HistoryFarm>(
    () => ({
      id: farm.id,
      name: farm.name,
      deliveryDays: Array.isArray(farm.delivery_days) ? farm.delivery_days.map(Number) : [],
    }),
    // delivery_days 배열 참조가 바뀌어도 내용이 같으면 다시 만들지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [farm.id, farm.name, JSON.stringify(farm.delivery_days ?? [])],
  )

  return <ShippingHistoryContent scopedFarm={scopedFarm} backTo={`${basePath}/delivery`} />
}
