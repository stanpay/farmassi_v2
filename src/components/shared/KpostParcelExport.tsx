import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { ErrorText } from '../ui/Feedback'
import { isDemoFarmOrderId, updateDemoFarmOrderStatus } from '../../lib/demoFarmOrders'
import { downloadKpostParcelExcel, ordersMissingZonecode } from '../../lib/kpostParcelExcel'
import type { OrderRow } from '../../lib/orders'
// import { supabase } from '../../lib/supabase'

interface KpostParcelExportProps {
  orders: OrderRow[]
  /** 파일명 farmassi_{농가명}_{날짜시간}.xlsx 에 쓰인다 */
  farmName?: string
  /** 입금완료 → 송장 발급 완료(packing) 반영 뒤 목록 갱신 */
  onUpdated?: () => void
  /** 배송 일시정지 중이면 사유. 있으면 내보내기를 막는다. */
  pausedReason?: string | null
}

export function KpostParcelExport({ orders, farmName, onUpdated, pausedReason }: KpostParcelExportProps) {
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const missingZip = ordersMissingZonecode(orders)

  return (
    <div className="space-y-2">
      {pausedReason && (
        <p className="text-xs text-amber-700">{pausedReason}</p>
      )}
      {missingZip.length > 0 && (
        <p className="text-xs text-amber-700">
          우편번호가 없는 주문이 {missingZip.length}건 있습니다. 우체국 주소검증에서 실패할 수 있습니다.
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      {message && <p className="text-sm text-primary">{message}</p>}
      <Button
        disabled={orders.length === 0 || busy || Boolean(pausedReason)}
        onClick={async () => {
          setError('')
          setMessage('')
          setBusy(true)
          try {
            await downloadKpostParcelExcel(orders, farmName)
            const paidOrders = orders.filter((order) => order.status === 'paid')
            // 세션 더미 주문은 API 없이 로컬만 입금완료 → 송장 발급 완료
            for (const order of paidOrders) {
              if (isDemoFarmOrderId(order.id)) {
                updateDemoFarmOrderStatus(order.farm_id, order.id, 'packing')
              }
            }
            // TODO(recording): 백엔드 꺼진 테스트 녹화용 — 서버 상태 갱신 임시 비활성
            // (켜면 "서버에 연결하지 못했습니다" 토스트가 뜬다)
            // const realIds = paidOrders.filter((order) => !isDemoFarmOrderId(order.id)).map((order) => order.id)
            // if (realIds.length > 0) {
            //   const results = await Promise.all(
            //     realIds.map((id) => supabase.from('orders').update({ status: 'packing' }).eq('id', id)),
            //   )
            //   const failed = results.find((result) => result.error)
            //   if (failed?.error) throw new Error(failed.error.message)
            // }
            if (paidOrders.length > 0) onUpdated?.()
            setMessage(
              paidOrders.length > 0
                ? `${orders.length}건 엑셀을 다운로드했습니다. ${paidOrders.length}건을 송장 발급 완료로 변경했습니다.`
                : `${orders.length}건 엑셀을 다운로드했습니다.`,
            )
          } catch (err) {
            setError(err instanceof Error ? err.message : '엑셀을 만들지 못했습니다.')
          } finally {
            setBusy(false)
          }
        }}
      >
        <Download className="h-4 w-4" />
        엑셀 다운로드 ({orders.length})
      </Button>
    </div>
  )
}
