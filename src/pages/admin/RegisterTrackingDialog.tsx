import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../components/ui/Button'
import { ErrorText } from '../../components/ui/Feedback'
import { Input, Select } from '../../components/ui/Field'
import { CARRIERS } from '../../lib/carriers'
import { invokeFunction } from '../../lib/functions'
import { OrderNoCombobox, type RecentOrder } from './OrderNoCombobox'

// 송장번호 직접 등록 (서버 RPC register-tracking).
// 등록만으로는 알림톡이 나가지 않는다. 택배사 기록(접수)이 Delivery Tracker 에 뜨면
// 서버가 주문을 배송중으로 바꾸고 배송시작(택배번호 안내) 알림톡을 보낸다.

interface RegisterResult {
  orderNo: string
  trackingNumber: string
  tracked: 'not_configured' | 'started' | 'already_started' | 'waiting' | 'error' | 'auth_error'
  webhook?: 'registered' | 'not_configured' | 'error'
}

const TRACKED_MESSAGE: Record<RegisterResult['tracked'], string> = {
  started: '택배사 접수가 이미 확인되어 배송중으로 바꾸고 배송시작 알림톡을 보냈습니다.',
  already_started: '이미 접수 처리된 송장입니다.',
  waiting: '아직 택배사 기록이 없습니다. 접수가 뜨면 배송중으로 바꾸고 배송시작 알림톡을 보냅니다.',
  error: '배송 조회에 실패했습니다. 10분 뒤 다시 확인합니다.',
  auth_error: '배송 조회 키가 만료됐거나 잘못됐습니다. 관리자에게 알렸습니다.',
  not_configured: '배송 조회(Delivery Tracker) 키가 아직 없어 접수 확인과 배송시작 알림톡이 멈춰 있습니다.',
}

export function RegisterTrackingDialog({
  open,
  orders,
  onClose,
  onSaved,
}: {
  open: boolean
  /** 등록할 수 있는 주문 (이 화면의 입금완료·송장 발급 완료·배송중) */
  orders: RecentOrder[]
  onClose: () => void
  onSaved: () => void
}) {
  const [orderNo, setOrderNo] = useState('')
  const [order, setOrder] = useState<RecentOrder | null>(null)
  const [carrierId, setCarrierId] = useState<string>(CARRIERS[0].id)
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<RegisterResult | null>(null)

  useEffect(() => {
    if (!open) return
    setOrderNo('')
    setOrder(null)
    setCarrierId(CARRIERS[0].id)
    setNumber('')
    setError('')
    setResult(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending, onClose])

  function findTyped() {
    const no = orderNo.trim().toUpperCase()
    if (!no) return
    const hit = orders.find((o) => o.order_no === no)
    if (hit) {
      setOrder(hit)
      setError('')
    } else {
      setOrder(null)
      setError(`${no} 는 송장을 등록할 수 있는 주문(입금완료·송장 발급 완료·배송중)에 없습니다.`)
    }
  }

  async function save() {
    if (!order) return
    setPending(true)
    setError('')
    setResult(null)
    try {
      const data = await invokeFunction<RegisterResult>('register-tracking', {
        orderId: order.id,
        carrierId,
        trackingNumber: number,
      })
      setResult(data)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  if (!open) return null
  const digits = number.replace(/[\s-]/g, '')
  const numberOk = /^\d{9,14}$/.test(digits)

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="닫기" disabled={pending} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-tracking-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-lg"
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 id="register-tracking-title" className="text-lg font-bold">
            송장번호 직접 등록
          </h2>
          <p className="mt-1 text-xs text-muted">
            택배사 접수가 확인되면 주문이 배송중으로 바뀌고 손님에게 배송시작 알림톡이 갑니다.
          </p>
        </div>

        <form
          className="flex-1 space-y-4 overflow-y-auto px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!order) findTyped()
            else if (numberOk && !result) void save()
          }}
        >
          <OrderNoCombobox
            value={orderNo}
            onChange={(value) => {
              setOrderNo(value)
              setResult(null)
              // 칸을 고치면 고른 주문을 내린다. 칸과 다른 주문에 등록하지 않게.
              if (order && value.trim().toUpperCase() !== order.order_no) setOrder(null)
            }}
            orders={orders}
            onPick={(picked) => {
              setOrderNo(picked.order_no)
              setOrder(picked)
              setError('')
              setResult(null)
            }}
            emptyText="송장을 등록할 수 있는 주문(입금완료·송장 발급 완료·배송중)에 없습니다."
          />

          {order && (
            <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm">
              {order.order_no} · {order.farms?.name ?? '농가'} ·{' '}
              {order.sender_name || order.depositor_name || order.recipient_name || '이름 없음'}
            </p>
          )}

          <Select label="택배사" value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
            {CARRIERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            label="송장번호"
            value={number}
            inputMode="numeric"
            autoComplete="off"
            placeholder="숫자만 (하이픈·띄어쓰기는 빼고 저장)"
            onChange={(e) => {
              setNumber(e.target.value)
              setResult(null)
            }}
            aria-invalid={number !== '' && !numberOk}
          />
          {number !== '' && !numberOk && <p className="text-xs text-red-600">송장번호는 숫자 9~14자리입니다.</p>}

          {error && <ErrorText>{error}</ErrorText>}
          {result && (
            <p className="text-sm text-primary" role="status">
              {result.orderNo} 에 {result.trackingNumber} 를 등록했습니다. {TRACKED_MESSAGE[result.tracked]}
              {result.tracked === 'waiting' &&
                (result.webhook === 'registered'
                  ? ' 접수되면 Delivery Tracker 가 바로 알려 줍니다(웹훅).'
                  : ' 웹훅을 걸지 못해 10분마다 조회해 확인합니다.')}
            </p>
          )}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>

        <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
          <Button type="button" variant="ghost" fullWidth disabled={pending} onClick={onClose}>
            닫기
          </Button>
          <Button
            type="button"
            fullWidth
            disabled={pending || !order || !numberOk || Boolean(result)}
            onClick={() => void save()}
          >
            {pending ? '등록 중...' : result ? '등록함' : '등록'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
