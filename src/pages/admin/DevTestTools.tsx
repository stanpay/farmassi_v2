import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../components/ui/Button'
import { ErrorText } from '../../components/ui/Feedback'
import { Input, Select } from '../../components/ui/Field'
import { CARRIERS } from '../../lib/carriers'
import { invokeFunction } from '../../lib/functions'
import { supabase } from '../../lib/supabase'
import { OrderNoCombobox, RECENT_ORDER_LIMIT, type RecentOrder } from './OrderNoCombobox'

// dev 시험 도구 (서버 RPC dev-test, DEV_TEST_TOOLS=1 인 서버에서만 켜진다).
// 실제 처리 코드를 그대로 태워 카카오톡 탭의 단계별 시각(초)을 확인한다.
//   시험 입금: 뱅크다가 주는 거래 1건과 같은 모양 → 운영과 같은 입금 처리(대사·입금완료·주문완료 알림톡)
//   시험 송장: 9999… 번호 등록 → 접수/배달완료 웹훅을 실제 공개 주소로 보냄 (택배사 기록만 흉내)

interface Inspect {
  orderNo: string
  status: string
  phone: string | null
  alimtalkAllowed: boolean
  amount: number
  depositorName: string | null
  farmAccount: boolean
  logs: Record<string, number>
  shipment: { tracking_number: string; started_at: string | null; delivered_at: string | null } | null
}

const STATUS_LABEL: Record<string, string> = {
  pending_deposit: '입금대기',
  paid: '입금완료',
  packing: '송장 발급 완료',
  shipping: '배송중',
  completed: '배송완료',
  cancelled: '취소',
}

export function DevTestTools({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [orders, setOrders] = useState<RecentOrder[] | null>(null)
  const [orderNo, setOrderNo] = useState('')
  const [order, setOrder] = useState<RecentOrder | null>(null)
  const [info, setInfo] = useState<Inspect | null>(null)
  const [delay, setDelay] = useState('30')
  const [carrierId, setCarrierId] = useState<string>(CARRIERS[0].id)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [messages, setMessages] = useState<string[]>([])

  useEffect(() => {
    if (!open || orders !== null) return
    void supabase
      .from('orders')
      .select('id, order_no, status, created_at, sender_name, recipient_name, depositor_name, farms(name)')
      .order('created_at', { ascending: false })
      .limit(RECENT_ORDER_LIMIT)
      .then(({ data }) => setOrders((data as RecentOrder[]) ?? []))
  }, [open, orders])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending, onClose])

  async function inspect(id: string) {
    try {
      setInfo(await invokeFunction<Inspect>('dev-test', { action: 'inspect', orderId: id }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function run(label: string, body: Record<string, unknown>, describe: (r: Record<string, unknown>) => string) {
    if (!order) return
    setPending(label)
    setError('')
    try {
      const r = await invokeFunction<Record<string, unknown>>('dev-test', { orderId: order.id, ...body })
      const time = new Date().toLocaleTimeString('ko-KR', { hour12: false })
      setMessages((m) => [`${time} ${label}: ${describe(r)}`, ...m].slice(0, 12))
      await inspect(order.id)
      onChanged()
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPending('')
    }
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="닫기" disabled={Boolean(pending)} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-test-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-lg"
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 id="dev-test-title" className="text-lg font-bold">
            시험 도구 <span className="text-sm font-normal text-muted">(dev 서버 전용)</span>
          </h2>
          <p className="mt-1 text-xs text-muted">
            실제 처리 코드를 그대로 탑니다. 뱅크다 조회와 택배사 기록만 흉내 냅니다. 알림톡은 주문 번호가 dev 허용 목록에
            있을 때만 실제로 나갑니다.
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <OrderNoCombobox
            value={orderNo}
            onChange={(value) => {
              setOrderNo(value)
              if (order && value.trim().toUpperCase() !== order.order_no) {
                setOrder(null)
                setInfo(null)
              }
            }}
            orders={orders}
            onPick={(picked) => {
              setOrderNo(picked.order_no)
              setOrder(picked)
              setMessages([])
              setError('')
              void inspect(picked.id)
            }}
          />

          {order && info && (
            <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 rounded-xl bg-gray-50 px-3 py-2 text-sm">
              <dt className="text-muted">상태</dt>
              <dd>{STATUS_LABEL[info.status] ?? info.status}</dd>
              <dt className="text-muted">받는 번호</dt>
              <dd>
                {info.phone ?? '없음'}{' '}
                <span className={info.alimtalkAllowed ? 'text-primary' : 'text-amber-700'}>
                  {info.alimtalkAllowed ? '· 알림톡 실제 발송됨' : '· 허용 목록 밖 → 알림톡은 건너뜀(기록 없음)'}
                </span>
              </dd>
              <dt className="text-muted">입금액</dt>
              <dd>
                {info.amount.toLocaleString()}원 · 입금자 {info.depositorName ?? '없음'}
                {!info.farmAccount && <span className="text-red-600"> · 농가 계좌 없음(대사 불가)</span>}
              </dd>
              <dt className="text-muted">알림톡 기록</dt>
              <dd>
                {Object.keys(info.logs).length === 0
                  ? '없음'
                  : Object.entries(info.logs).map(([k, n]) => `${k} ${n}`).join(', ')}
              </dd>
              <dt className="text-muted">송장</dt>
              <dd>
                {info.shipment
                  ? `${info.shipment.tracking_number}${info.shipment.started_at ? ' · 접수됨' : ''}${info.shipment.delivered_at ? ' · 배달완료' : ''}`
                  : '없음'}
              </dd>
            </dl>
          )}

          {order && (
            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                fullWidth
                disabled={Boolean(pending)}
                onClick={() => void run('처음 상태로', { action: 'reset' }, () => '입금대기로 되돌리고 이 주문의 시험 기록을 지웠습니다')}
              >
                ① 처음 상태로 (입금대기, 이 주문의 알림톡·시험 입금·시험 송장 기록 삭제)
              </Button>

              <div className="flex items-end gap-2">
                <div className="w-40">
                  <Input
                    label="은행 입금 → 뱅크다 수신(초)"
                    inputMode="numeric"
                    value={delay}
                    onChange={(e) => setDelay(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={Boolean(pending) || info?.status !== 'pending_deposit'}
                  onClick={() =>
                    void run('시험 입금', { action: 'deposit', bankDelaySeconds: Number(delay || 0) }, (r) =>
                      r.matched ? '대사됨 → 입금완료 → 주문완료 알림톡' : `대사 안 됨 (${(r.deposit as { reason?: string })?.reason ?? '사유 없음'})`,
                    )
                  }
                >
                  ② 시험 입금 (뱅크다 형식)
                </Button>
              </div>

              <div className="flex items-end gap-2">
                <div className="w-40">
                  <Select label="택배사" value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
                    {CARRIERS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={Boolean(pending) || !['paid', 'packing', 'shipping'].includes(info?.status ?? '')}
                  onClick={() =>
                    void run('시험 송장 등록', { action: 'parcel', carrierId }, (r) => `${String(r.trackingNumber ?? '')} 등록`)
                  }
                >
                  ③ 시험 송장 등록
                </Button>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={Boolean(pending) || !info?.shipment}
                  onClick={() =>
                    void run('접수 웹훅', { action: 'event', event: 'pickup' }, (r) => `웹훅 보냄 (응답 ${String(r.webhookStatus)})`)
                  }
                >
                  ④ 접수 웹훅
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={Boolean(pending) || !info?.shipment}
                  onClick={() =>
                    void run('배달완료 웹훅', { action: 'event', event: 'delivered' }, (r) => `웹훅 보냄 (응답 ${String(r.webhookStatus)})`)
                  }
                >
                  ⑤ 배달완료 웹훅
                </Button>
              </div>
              <p className="text-xs text-muted">
                웹훅은 실제 공개 주소로 보내고, 서버가 받은 뒤 처리합니다. 결과는 몇 초 뒤 발송 로그·배송 웹훅 수신에 나옵니다
                (목록은 1분마다 새로고침, 바로 보려면 페이지 새로고침).
              </p>
            </div>
          )}

          {error && <ErrorText>{error}</ErrorText>}
          {messages.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-gray-50 px-3 py-2 font-mono text-xs" aria-label="시험 기록">
              {messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-100 px-5 py-4">
          <Button type="button" variant="ghost" fullWidth disabled={Boolean(pending)} onClick={onClose}>
            {pending ? `${pending} 중...` : '닫기'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
