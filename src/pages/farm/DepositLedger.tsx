import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Header } from '../../components/layout/Header'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ErrorText, PageSpinner } from '../../components/ui/Feedback'
import { formatPrice } from '../../lib/format'
import { invokeFunction } from '../../lib/functions'
import { useFarmWorkspace } from '../../lib/farmWorkspace'
import { supabase } from '../../lib/supabase'

/**
 * 농가 입금 내역 원장.
 * 관리자 원장과 동일하되 현재 농가 건만 보여 준다.
 */

interface DepositRow {
  id: string
  farm_id: string | null
  provider: string
  occurred_at: string
  amount: number
  depositor_name: string | null
  match_status: 'unmatched' | 'matched' | 'ignored'
  matched_order_id: string | null
  raw_payload: Record<string, unknown> | null
}

interface OrderRow {
  id: string
  order_no: string
  farm_id: string
  status: string
  recipient_name: string
  deposit_code: string
  deposit_due_amount: number
  created_at: string
}

const STATUS_LABEL: Record<DepositRow['match_status'], string> = {
  matched: '주문 연결됨',
  unmatched: '확인 필요',
  ignored: '무시함',
}

const REASON_LABEL: Record<string, string> = {
  amount_unique: '금액이 맞는 주문이 하나뿐이라 자동 연결',
  deposit_code: '입금자명의 입금코드로 자동 연결',
  recipient_name: '입금자명이 수령인과 같아 자동 연결',
  no_amount_match: '금액이 맞는 입금대기 주문이 없음',
  ambiguous: '금액이 같은 주문이 여럿이라 판단 보류',
}

function when(value: string) {
  return new Date(value).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export function FarmDepositLedger() {
  const { farm, basePath } = useFarmWorkspace()
  const [deposits, setDeposits] = useState<DepositRow[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | DepositRow['match_status']>('unmatched')
  const [openId, setOpenId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [d, o] = await Promise.all([
      supabase.from('deposit_transactions').select('*')
        .eq('farm_id', farm.id).order('occurred_at', { ascending: false }),
      supabase.from('orders').select('id, order_no, farm_id, status, recipient_name, deposit_code, deposit_due_amount, created_at')
        .eq('farm_id', farm.id).eq('status', 'pending_deposit').order('created_at', { ascending: false }),
    ])
    setDeposits((d.data as DepositRow[]) ?? [])
    setOrders((o.data as OrderRow[]) ?? [])
    setLoading(false)
  }, [farm.id])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(
    () => (filter === 'all' ? deposits : deposits.filter((d) => d.match_status === filter)),
    [deposits, filter],
  )
  const counts = useMemo(() => ({
    all: deposits.length,
    unmatched: deposits.filter((d) => d.match_status === 'unmatched').length,
    matched: deposits.filter((d) => d.match_status === 'matched').length,
    ignored: deposits.filter((d) => d.match_status === 'ignored').length,
  }), [deposits])

  async function run(body: Record<string, unknown>) {
    setPending(true)
    setError('')
    try {
      await invokeFunction('match-deposit', body)
      setOpenId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '처리하지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  if (loading) return <PageSpinner />

  return (
    <>
      <Header title="입금 내역" subtitle="자동으로 붙지 않은 입금을 직접 연결" showBack backTo={`${basePath}/deposits`} />
      <div className="px-4 py-4 md:px-6 max-w-3xl mx-auto space-y-3">
        {error && <ErrorText>{error}</ErrorText>}

        <div className="flex flex-wrap gap-2">
          {(['unmatched', 'matched', 'ignored', 'all'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                filter === key ? 'bg-primary text-white' : 'bg-white text-muted border border-gray-200'
              }`}
            >
              {key === 'all' ? '전체' : STATUS_LABEL[key]} {counts[key]}
            </button>
          ))}
        </div>

        {visible.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">해당하는 입금 내역이 없습니다.</p>
        )}

        {visible.map((deposit) => {
          const reason = String(deposit.raw_payload?.match_reason ?? '')
          const manual = Boolean(deposit.raw_payload?.matched_manually)
          return (
            <Card key={deposit.id} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-gray-900">
                    {formatPrice(deposit.amount)}
                    <span className="ml-2 text-sm font-normal text-gray-700">
                      {deposit.depositor_name || '(입금자명 없음)'}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    {when(deposit.occurred_at)} · {deposit.provider}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${
                    deposit.match_status === 'matched'
                      ? 'bg-primary-light text-primary'
                      : deposit.match_status === 'ignored'
                        ? 'bg-gray-100 text-muted'
                        : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  {STATUS_LABEL[deposit.match_status]}
                </span>
              </div>

              {reason && (
                <p className="text-xs text-muted">
                  {manual ? '직접 연결함' : REASON_LABEL[reason] ?? reason}
                </p>
              )}

              {deposit.match_status === 'matched' && deposit.matched_order_id && (
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`${basePath}/orders?highlight=${deposit.matched_order_id}`}
                    className="text-xs font-semibold text-primary"
                  >
                    연결된 주문 보기
                  </Link>
                  <Button size="sm" variant="ghost" disabled={pending}
                    onClick={() => void run({ action: 'unmatch', depositId: deposit.id })}>
                    연결 해제
                  </Button>
                </div>
              )}

              {deposit.match_status !== 'matched' && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline"
                      onClick={() => setOpenId(openId === deposit.id ? null : deposit.id)}>
                      {openId === deposit.id ? '닫기' : '주문에 연결'}
                    </Button>
                    {deposit.match_status !== 'ignored' && (
                      <Button size="sm" variant="ghost" disabled={pending}
                        onClick={() => void run({ action: 'ignore', depositId: deposit.id })}>
                        주문과 무관
                      </Button>
                    )}
                  </div>

                  {openId === deposit.id && (
                    <div className="space-y-2 rounded-xl bg-gray-50 p-3">
                      <p className="text-xs text-muted">
                        입금대기 주문 {orders.length}건. 금액이 달라도 연결할 수 있습니다.
                      </p>
                      {orders.length === 0 && (
                        <p className="text-xs text-muted">연결할 입금대기 주문이 없습니다.</p>
                      )}
                      {orders.map((order) => {
                        const same = order.deposit_due_amount === deposit.amount
                        return (
                          <div key={order.id}
                            className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-gray-900">
                                {order.order_no}
                                <span className="ml-2 font-normal text-gray-700">{order.recipient_name}</span>
                              </p>
                              <p className={`text-xs ${same ? 'text-muted' : 'text-amber-700'}`}>
                                {formatPrice(order.deposit_due_amount)} · 입금코드 {order.deposit_code}
                                {same ? '' : ' · 금액 다름'}
                              </p>
                            </div>
                            <Button size="sm" disabled={pending}
                              onClick={() => void run({ action: 'match', depositId: deposit.id, orderId: order.id })}>
                              연결
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}
