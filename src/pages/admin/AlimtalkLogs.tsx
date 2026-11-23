import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { Header } from '../../components/layout/Header'
import { FarmFilterChips } from '../../components/shared/FarmFilterChips'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { ErrorText, PageSpinner } from '../../components/ui/Feedback'
import { adminNavItems } from '../../config/adminNav'
import { formatDateTime } from '../../lib/format'
import { supabase } from '../../lib/supabase'

// 알림톡 발송 로그 (관리자). 서버가 1분마다 알리고에 결과를 물어 채운다.
// 알림톡 실패 사유는 알리고 rslt_message, 대체문자 결과는 sms_list 의 sms_state 그대로다.

type Result = 'pending' | 'alimtalk' | 'sms' | 'failed'

interface LogRow {
  id: string
  kind: string
  farm_id: string | null
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
  orders: { order_no: string } | null
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
  const [farmId, setFarmId] = useState<string | 'all'>('all')
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  async function load() {
    const { data, error: loadError } = await supabase
      .from('alimtalk_logs')
      .select('*, farms(name), orders(order_no)')
      .order('created_at', { ascending: false })
      .limit(300)
    if (loadError) setError(loadError.message)
    setRows((data as LogRow[]) ?? [])
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
      <Header title="카카오톡" subtitle="알림톡 발송 로그" />
      <div className="px-4 py-4 md:px-6 max-w-3xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to="/admin/kakao" className="text-sm text-primary underline">
            ← 템플릿 관리
          </Link>
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

        {rows === null ? (
          <PageSpinner label="로그 불러오는 중..." />
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted">{onlyFailed ? '실패한 발송이 없습니다.' : '발송 기록이 없습니다.'}</p>
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
                    {row.orders?.order_no && <span className="text-xs text-muted">{row.orders.order_no}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                    <span>{formatDateTime(row.created_at)}</span>
                    <span>{maskPhone(row.phone)}</span>
                    <span>{row.tpl_code}</span>
                  </div>
                  {row.fail_reason && <p className="text-sm text-red-600">{row.fail_reason}</p>}
                </button>
                {expanded && (
                  <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 border-t border-gray-100 pt-2 text-xs">
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
      </div>
    </AppShell>
  )
}
