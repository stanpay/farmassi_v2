import { useEffect, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PageSpinner } from '../../components/ui/Feedback'
import { CARRIER_NAME } from '../../lib/carriers'
import { supabase } from '../../lib/supabase'
import { formatSeconds } from '../../lib/timeFormat'

// Delivery Tracker 가 보낸 웹훅 하나하나 (카카오톡 탭 '배송 웹훅 수신').
// 받은 시각은 서버가 요청을 받은 순간(초 단위). 내용은 믿지 않고 서버가 다시 조회해 처리한 결과를 함께 보여 준다.

interface WebhookEvent {
  id: string
  received_at: string
  processed_at: string | null
  carrier_id: string | null
  tracking_number: string | null
  outcome: string | null
  error: string | null
  shipments: { orders: { order_no: string; farms: { name: string } | null } | null } | null
}

const OUTCOME: Record<string, { label: string; variant: 'primary' | 'accent' | 'neutral' | 'cold' }> = {
  started: { label: '접수 처리 → 배송중', variant: 'primary' },
  delivered: { label: '배달완료 처리 → 배송완료', variant: 'primary' },
  in_transit: { label: '배송 중 (처리할 변화 없음)', variant: 'neutral' },
  waiting: { label: '택배사 기록 아직 없음', variant: 'neutral' },
  already_started: { label: '이미 처리됨', variant: 'neutral' },
  already_delivered: { label: '이미 처리됨', variant: 'neutral' },
  no_shipment: { label: '등록된 송장 아님', variant: 'cold' },
  error: { label: '처리 오류', variant: 'accent' },
  auth_error: { label: '조회 키 오류', variant: 'accent' },
}

export function DeliveryWebhookEvents() {
  const [rows, setRows] = useState<WebhookEvent[] | null>(null)
  const [error, setError] = useState('')

  async function load() {
    const { data, error: loadError } = await supabase
      .from('delivery_webhook_events')
      .select('*, shipments(orders(order_no, farms(name)))')
      .order('received_at', { ascending: false })
      .limit(300)
    // 알림톡 로그와 같이: 실패해도 이전 목록을 두고 알림만.
    if (loadError) {
      setError(loadError.message)
      setRows((prev) => prev ?? [])
      return
    }
    setError('')
    setRows((data as WebhookEvent[]) ?? [])
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        택배 상태가 바뀌면 Delivery Tracker 가 서버로 알려 줍니다(웹훅). 서버는 받은 즉시 시각을 남기고, 송장을 다시 조회해
        접수면 배송중·배송시작 알림톡, 배달완료면 배송완료·배송완료 알림톡을 처리합니다.
      </p>
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>기록을 다시 읽지 못했습니다: {error}. 1분 뒤 다시 시도합니다.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
            지금 다시 시도
          </Button>
        </div>
      )}
      {rows === null ? (
        <PageSpinner label="웹훅 기록 불러오는 중..." />
      ) : rows.length === 0 ? (
        error ? null : <p className="text-sm text-muted">받은 웹훅이 없습니다.</p>
      ) : (
        rows.map((row) => {
          const outcome = OUTCOME[row.outcome ?? ''] ?? { label: row.outcome ? row.outcome : '처리 중', variant: 'neutral' as const }
          const order = row.shipments?.orders
          const ms =
            row.processed_at && Math.max(0, new Date(row.processed_at).getTime() - new Date(row.received_at).getTime())
          return (
            <Card key={row.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={outcome.variant}>{outcome.label}</Badge>
                <span className="font-mono text-sm tabular-nums">{formatSeconds(row.received_at)}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                {order?.order_no && <span className="font-medium text-gray-900">주문 {order.order_no}</span>}
                {order?.farms?.name && <span>{order.farms.name}</span>}
                <span>
                  {(row.carrier_id && CARRIER_NAME[row.carrier_id]) || row.carrier_id || '택배사 없음'} {row.tracking_number || '-'}
                </span>
                {ms !== null && ms !== '' && <span>처리 {ms}ms</span>}
              </div>
              {row.error && <p className="text-sm text-red-600">{row.error}</p>}
            </Card>
          )
        })
      )}
    </div>
  )
}
