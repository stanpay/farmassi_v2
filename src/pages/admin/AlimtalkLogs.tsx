import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { Header } from '../../components/layout/Header'
import { FarmFilterChips } from '../../components/shared/FarmFilterChips'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PageSpinner } from '../../components/ui/Feedback'
import { adminNavItems } from '../../config/adminNav'
import { formatDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { AlimtalkSendDialog } from './AlimtalkSendDialog'
import { AlimtalkTimeline, type TimelineLog, type TimelineProfile } from './AlimtalkTimeline'
import { DeliveryWebhookEvents } from './DeliveryWebhookEvents'

// 알림톡 발송 로그 (관리자). 서버가 1분마다 알리고에 결과를 물어 채운다.
// 알림톡 실패 사유는 알리고 rslt_message, 대체문자 결과는 sms_list 의 sms_state 그대로다.

type Result = 'pending' | 'alimtalk' | 'sms' | 'failed'

interface LogRow extends Omit<TimelineLog, 'orders'> {
  id: string
  kind: string
  farm_id: string | null
  order_id: string | null
  user_id: string | null
  sent_by: string | null
  resend_of: string | null
  phone: string | null
  tpl_code: string | null
  result: Result
  at_rslt: string | null
  at_rslt_message: string | null
  smid: string | null
  sms_state: string | null
  fail_reason: string | null
  message: string | null
  created_at: string
  checked_at: string | null
  alerted_at: string | null
  farms: { name: string } | null
  orders: ({ order_no: string } & NonNullable<TimelineLog['orders']>) | null
  /** 보낼 때 남긴 주문번호 (주문이 지워져도 남는다) */
  order_no: string | null
}

const KIND_LABEL: Record<string, string> = {
  order_done: '주문완료',
  tracking: '택배번호',
  delivered: '배송완료',
  signup: '회원가입',
}

const RESULT_LABEL: Record<Result, { label: string; variant: 'primary' | 'accent' | 'neutral' | 'cold' }> = {
  pending: { label: '확인 중', variant: 'neutral' },
  alimtalk: { label: '알림톡 도착', variant: 'primary' },
  sms: { label: '문자로 도착', variant: 'cold' },
  failed: { label: '실패', variant: 'accent' },
}

const NO_FARM = 'none'

function maskPhone(phone: string | null) {
  if (!phone) return '번호 없음'
  return phone.length >= 10 ? `${phone.slice(0, 3)}-****-${phone.slice(-4)}` : phone
}

export function AdminAlimtalkLogs() {
  const [rows, setRows] = useState<LogRow[] | null>(null)
  const [error, setError] = useState('')
  const [failedAt, setFailedAt] = useState<string | null>(null)
  const [farmId, setFarmId] = useState<string | 'all'>('all')
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  // null: 닫힘, 'new': 새로 수동 발송, 그 밖: 재전송할 로그 id
  const [sending, setSending] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<Record<string, TimelineProfile>>({})
  // 알림톡 발송 로그 / 배송 웹훅 수신 기록
  const [view, setView] = useState<'logs' | 'webhooks'>('logs')

  async function load() {
    const { data, error: loadError } = await supabase
      .from('alimtalk_logs')
      .select(
        '*, farms(name), orders(order_no, paid_at, deposit_confirmed_at, completed_at,' +
          ' deposit_transactions(occurred_at, created_at, provider),' +
          ' shipments(status, tracker_first_event_at, started_at, started_via, started_webhook_at,' +
          ' delivered_at, delivered_via, delivered_webhook_at, tracker_delivered_event_at))',
      )
      .order('created_at', { ascending: false })
      .limit(300)
    // 1분마다 다시 읽는다. 한 번 실패했다고 목록을 비우지 않는다 — 전에 읽은 목록을 두고
    // 위에 '새로고침 실패'만 알린다. 다음에 성공하면 알림을 지운다 (11/25: 서버 재시작·DB 변경 중
    // 한 번 실패하면 화면이 비고 새로고침 전까지 돌아오지 않았다).
    if (loadError) {
      setError(loadError.message)
      setFailedAt(new Date().toISOString())
      setRows((prev) => prev ?? [])
      return
    }
    setError('')
    setFailedAt(null)
    const list = (data as LogRow[]) ?? []
    setRows(list)
    // 회원가입 알림톡의 시작 시각(가입·연락처 저장)은 회원 정보에 있다. 로그→회원 연결이 둘(받는 회원,
    // 보낸 관리자)이라 한 번에 붙여 읽지 않고 따로 읽는다.
    const ids = [...new Set(list.filter((r) => r.kind === 'signup' && r.user_id).map((r) => r.user_id as string))]
    if (ids.length > 0) {
      const { data: people } = await supabase.from('profiles').select('id, created_at, phone_first_set_at').in('id', ids)
      setProfiles(Object.fromEntries(((people ?? []) as ({ id: string } & TimelineProfile)[]).map((p) => [p.id, p])))
    }
  }

  useEffect(() => {
    void load()
    // 확인 중인 건이 결과로 바뀌는 걸 보려고 1분마다 다시 읽는다 (서버 확인 주기와 같음).
    const timer = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const farms = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>()
    for (const row of rows ?? []) {
      const id = row.farm_id ?? NO_FARM
      const name = row.farms?.name ?? '농가 없음 (회원가입·시험)'
      const item = map.get(id) ?? { id, name, count: 0 }
      item.count += 1
      map.set(id, item)
    }
    return [...map.values()]
  }, [rows])

  const visible = useMemo(
    () =>
      (rows ?? []).filter(
        (row) =>
          (farmId === 'all' || (row.farm_id ?? NO_FARM) === farmId) && (!onlyFailed || row.result === 'failed'),
      ),
    [rows, farmId, onlyFailed],
  )
  const failedCount = (rows ?? []).filter((row) => row.result === 'failed').length

  return (
    <AppShell navItems={adminNavItems} roleLabel="관리자" settingsPath="/admin/none">
      <Header title="카카오톡" subtitle={view === 'logs' ? '알림톡 발송 로그' : '배송 웹훅 수신 기록'} />
      <div className="px-4 py-4 md:px-6 max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" onClick={() => setSending('new')}>
            수동 발송
          </Button>
          <Link to="/admin/kakao/template" className="text-sm text-primary underline">
            템플릿 보기 →
          </Link>
        </div>
        <div className="flex gap-2" role="tablist" aria-label="기록 종류">
          {([
            ['logs', '알림톡 발송'],
            ['webhooks', '배송 웹훅 수신'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                view === id ? 'bg-primary text-white' : 'border border-gray-200 bg-white text-muted hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {view === 'webhooks' ? (
          <DeliveryWebhookEvents />
        ) : (
        <>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} />
            실패만 보기 {failedCount > 0 && <Badge variant="accent">{failedCount}</Badge>}
          </label>
        </div>
        <p className="text-xs text-muted">
          알림톡이 실패하면 같은 내용이 문자로 갑니다. 서버가 1분마다 결과를 확인하고, 문자까지 실패하면
          관리자에게 메일로 알립니다.
        </p>

        <FarmFilterChips farms={farms} selectedId={farmId} onSelect={setFarmId} allCount={rows?.length ?? 0} />

        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>
              로그를 다시 읽지 못했습니다
              {failedAt && ` (${new Date(failedAt).toLocaleTimeString('ko-KR', { hour12: false })})`}: {error}.{' '}
              {rows && rows.length > 0 ? '아래는 직전에 읽은 목록입니다. ' : ''}1분 뒤 다시 시도합니다.
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
              지금 다시 시도
            </Button>
          </div>
        )}
        {rows === null ? (
          <PageSpinner label="로그 불러오는 중..." />
        ) : visible.length === 0 ? (
          error ? null : (
            <p className="text-sm text-muted">{onlyFailed ? '실패한 발송이 없습니다.' : '발송 기록이 없습니다.'}</p>
          )
        ) : (
          visible.map((row) => {
            const result = RESULT_LABEL[row.result] ?? RESULT_LABEL.pending
            const expanded = open === row.id
            return (
              <Card key={row.id} className="space-y-2">
                <button
                  type="button"
                  className="w-full text-left space-y-1"
                  onClick={() => setOpen(expanded ? null : row.id)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={result.variant}>{result.label}</Badge>
                    <span className="font-bold">{KIND_LABEL[row.kind] ?? row.kind}</span>
                    <span className="text-sm text-muted">{row.farms?.name ?? '농가 없음'}</span>
                    {row.sent_by && (
                      <Badge variant="neutral">{row.resend_of ? '재전송' : '수동 발송'}</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                    {(row.order_no ?? row.orders?.order_no) && (
                      <span className="font-medium text-gray-900">주문 {row.order_no ?? row.orders?.order_no}</span>
                    )}
                    <span>{formatDateTime(row.created_at)}</span>
                    <span>{maskPhone(row.phone)}</span>
                    <span>{row.tpl_code}</span>
                  </div>
                  {row.fail_reason && <p className="text-sm text-red-600">{row.fail_reason}</p>}
                </button>
                {/* 실패·문자로 도착 포함 모든 건. 주문·회원이 없는 기록은 처음 보낸 번호로 다시 보낸다. */}
                {row.phone && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant={row.result === 'failed' ? 'primary' : 'ghost'}
                      onClick={() => setSending(row.id)}
                    >
                      재전송
                    </Button>
                  </div>
                )}
                {expanded && (
                  <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 border-t border-gray-100 pt-2 text-xs">
                    <dt className="text-muted">시간 (초)</dt>
                    <dd>
                      <AlimtalkTimeline log={row} profile={row.user_id ? profiles[row.user_id] : null} />
                    </dd>
                    <dt className="text-muted">알림톡 결과</dt>
                    <dd>{row.at_rslt ? `${row.at_rslt} · ${row.at_rslt_message ?? ''}` : '아직 없음'}</dd>
                    <dt className="text-muted">대체문자</dt>
                    <dd>{row.smid ? `${row.sms_state ?? '확인 중'} (smid ${row.smid})` : '없음'}</dd>
                    <dt className="text-muted">마지막 확인</dt>
                    <dd>{row.checked_at ? formatDateTime(row.checked_at) : '-'}</dd>
                    <dt className="text-muted">관리자 알림</dt>
                    <dd>{row.alerted_at ? formatDateTime(row.alerted_at) : '-'}</dd>
                    <dt className="text-muted">보낸 내용</dt>
                    <dd className="whitespace-pre-wrap">{row.message ?? '-'}</dd>
                  </dl>
                )}
              </Card>
            )
          })
        )}
        </>
        )}
      </div>
      <AlimtalkSendDialog
        open={sending !== null}
        logId={sending && sending !== 'new' ? sending : null}
        onClose={() => setSending(null)}
        onSent={() => void load()}
      />
    </AppShell>
  )
}
