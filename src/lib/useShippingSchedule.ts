import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import {
  arrivalDate, isAfterCutoff, nextShipDate, pauseCovering, prevShipDate, shipDate,
  todayInSeoul, type PauseRange,
} from './deliveryEstimate'

/**
 * 농가의 예상 배송일정.
 *
 * 정지 구간과 공휴일을 DB 에서 읽어 계산한다. 정지 구간은 관리자와 농가가
 * 각각 걸 수 있어 행이 여러 개고, 겹치면 계산이 알아서 합산한다.
 */
export function useShippingSchedule(
  farmId: string | null | undefined,
  days: number[] | null | undefined,
  /** 손님이 고른 출고일. 없으면 가장 이른 출고일. */
  chosen?: string | null,
) {
  const [pauses, setPauses] = useState<PauseRange[]>([])
  const [holidays, setHolidays] = useState<Set<string>>(new Set())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!farmId) return
    let alive = true
    void (async () => {
      const today = todayInSeoul()
      const [pauseRes, holidayRes] = await Promise.all([
        supabase.from('shipping_pauses').select('start_date, end_date, reason')
          .eq('farm_id', farmId).gte('end_date', today),
        supabase.from('holidays').select('holiday_date').gte('holiday_date', today),
      ])
      if (!alive) return
      setPauses((pauseRes.data ?? []) as PauseRange[])
      setHolidays(new Set((holidayRes.data ?? []).map((row: any) => row.holiday_date)))
      setReady(true)
    })()
    return () => { alive = false }
  }, [farmId])

  const today = todayInSeoul()
  const earliest = shipDate(days ?? [], pauses, today, holidays)
  // 고른 날이 가장 이른 출고일보다 앞이면 무시한다. 요일 설정이나 정지가
  // 바뀌어 고를 당시의 날짜가 더 이상 유효하지 않을 수 있다.
  const ship = chosen && earliest && chosen >= earliest ? chosen : earliest
  // 마감 안내는 '내일이 출고일일 때만' 띄운다. 마감 전이라면 내일 나가는 경우,
  // 마감 후라면 마감만 아니었으면 내일 나갔을 경우다. 어차피 모레 이후에나
  // 나가는 농가에는 마감 이야기를 할 이유가 없다.
  const shipIfInTime = shipDate(days ?? [], pauses, today, holidays, false)
  const tomorrow = (() => {
    const [y, m, d] = today.split('-').map(Number)
    const next = new Date(y, m - 1, d + 1)
    const pad = (n: number) => `${n}`.padStart(2, '0')
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
  })()
  const afterCutoff = isAfterCutoff()
  return {
    /** 마감을 넘겨 출고가 밀렸나 (= 마감만 아니었으면 내일 나갔나) */
    missedCutoff: afterCutoff && shipIfInTime === tomorrow,
    /** 마감 전이고 내일 나가나 */
    shipsTomorrow: !afterCutoff && ship === tomorrow,
    ready,
    pauses,
    /** 오늘 정지 중인가 (주문은 받되 안내를 띄운다) */
    activePause: pauseCovering(pauses, today),
    /** 출고를 미루게 만든 정지 (미래 정지 포함) */
    blockingPause: ship ? null : (pauses[0] ?? null),
    shipDate: ship,
    arrivalDate: ship ? arrivalDate(ship, holidays) : null,
    holidays,
    /** 가장 이른 출고일. 이보다 앞으로는 못 당긴다. */
    earliestShipDate: earliest,
    /** 손님이 뒤로 미뤄 둔 상태인가 */
    shipMoved: Boolean(earliest && ship && ship > earliest),
    nextShipDate: ship ? nextShipDate(ship, days ?? [], pauses, holidays) : null,
    prevShipDate: ship && earliest ? prevShipDate(ship, earliest, days ?? [], pauses, holidays) : null,
  }
}
