import { useState } from 'react'
import { isDemoFarmOrderId } from '../../lib/demoFarmOrders'
import { invokeFunction } from '../../lib/functions'
import { Button } from '../ui/Button'

export function DepositConfirmExtra({
  orderId,
  depositCode,
  onConfirmed,
}: {
  orderId: string
  depositCode: string
  onConfirmed: () => void
}) {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">입금자명 {depositCode}</p>
        <Button
          size="sm"
          disabled={pending}
          onClick={async () => {
            setError('')
            setPending(true)
            try {
              // TODO(demo): 세션 더미 주문은 API 없이 로컬 상태만 갱신
              if (!isDemoFarmOrderId(orderId)) {
                await invokeFunction('confirm-deposit', { orderId, provider: 'manual' })
              }
              onConfirmed()
            } catch (err) {
              setError(err instanceof Error ? err.message : '입금 확인에 실패했습니다.')
            } finally {
              setPending(false)
            }
          }}
        >
          입금 확인
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
