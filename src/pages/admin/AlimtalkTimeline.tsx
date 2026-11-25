// 알림톡 1건이 나가기까지의 시각을 초 단위로 (카카오톡 발송 로그 펼침).
//
// 주문완료: 은행 입금(뱅크다 거래 시각) → 뱅크다에서 가져옴 → 입금완료 처리 → 발송
// 택배번호: 택배사 접수(Delivery Tracker 기록) → 웹훅 수신 → 접수 확인 → 발송
//          (웹훅이 아니라 조회·등록 직후 조회로 확인했으면 그 경로를 적는다)
// 공통 발송: 발송 요청(서버→알리고) → 알리고 접수 → 카카오 발송 → 결과 수신 → 리포트 → 대체문자 발송

export interface TimelineDeposit {
  occurred_at: string | null
  created_at: string | null
  provider: string | null
}

export interface TimelineShipment {
  status: string
  tracker_first_event_at: string | null
  started_at: string | null
  started_via?: string | null
  started_webhook_at?: string | null
}

const VIA_NOTE: Record<string, string> = {
  webhook: '웹훅을 받고 다시 조회해 확인',
  poll: '서버 정기 조회로 확인 (웹훅 못 받음)',
  register: '송장 등록 직후 조회로 확인',
}

export interface TimelineLog {
  kind: string
  created_at: string
  at_req_at: string | null
  at_sent_at: string | null
  at_result_at: string | null
  at_report_at: string | null
  sms_sent_at: string | null
  result: string
  orders: {
    paid_at?: string | null
    deposit_confirmed_at?: string | null
    deposit_transactions?: TimelineDeposit[] | null
    shipments?: TimelineShipment[] | null
  } | null
}

interface Step {
  label: string
  note?: string
  at: string
}

const SECONDS = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function formatSeconds(value: string) {
  return SECONDS.format(new Date(value))
}

/** 앞 단계와의 간격: +2초, +3분 5초, +1시간 2분, +2일 3시간 */
function gap(fromIso: string, toIso: string) {
  const diff = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000)
  const sign = diff < 0 ? '-' : '+'
  let s = Math.abs(diff)
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  const parts = d ? [`${d}일`, h && `${h}시간`] : h ? [`${h}시간`, m && `${m}분`] : m ? [`${m}분`, s && `${s}초`] : [`${s}초`]
  return sign + parts.filter(Boolean).join(' ')
}

function steps(log: TimelineLog): Step[] {
  const out: Step[] = []
  const order = log.orders
  if (log.kind === 'order_done' && order) {
    const deposits = (order.deposit_transactions ?? []).filter((d) => d.occurred_at)
    const deposit = deposits.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
    if (deposit?.occurred_at) {
      out.push({
        label: deposit.provider === 'bankda' ? '은행 입금' : '입금 기록',
        note: deposit.provider === 'bankda' ? '뱅크다가 준 거래 시각' : `${deposit.provider ?? ''} 입력`,
        at: deposit.occurred_at,
      })
    }
    if (deposit?.provider === 'bankda' && deposit.created_at) {
      out.push({ label: '뱅크다에서 가져옴', note: '서버가 뱅크다 조회로 받은 시각', at: deposit.created_at })
    }
    const paid = order.paid_at ?? order.deposit_confirmed_at
    if (paid) out.push({ label: '입금완료 처리', at: paid })
  }
  if (log.kind === 'tracking' && order) {
    const shipment = (order.shipments ?? []).find((s) => s.status !== 'cancelled' && s.started_at)
    if (shipment?.tracker_first_event_at) {
      out.push({ label: '택배사 접수', note: 'Delivery Tracker 기록 시각', at: shipment.tracker_first_event_at })
    }
    if (shipment?.started_webhook_at) {
      out.push({ label: '웹훅 수신', note: 'Delivery Tracker → 서버', at: shipment.started_webhook_at })
    }
    if (shipment?.started_at) {
      out.push({
        label: '접수 확인',
        note: VIA_NOTE[shipment.started_via ?? ''] ?? '서버 조회로 확인',
        at: shipment.started_at,
      })
    }
  }
  out.push({ label: '발송 요청', note: '서버 → 알리고', at: log.created_at })
  if (log.at_req_at) out.push({ label: '알리고 접수', at: log.at_req_at })
  if (log.at_sent_at) out.push({ label: '카카오 발송', at: log.at_sent_at })
  if (log.at_result_at) out.push({ label: '결과 수신', note: log.result === 'alimtalk' ? '알림톡 도착' : undefined, at: log.at_result_at })
  if (log.at_report_at) out.push({ label: '리포트', at: log.at_report_at })
  if (log.sms_sent_at) out.push({ label: '대체문자 발송', at: log.sms_sent_at })
  return out
}

export function AlimtalkTimeline({ log }: { log: TimelineLog }) {
  const list = steps(log)
  return (
    <ol className="space-y-1" aria-label="시간 (초 단위)">
      {list.map((step, i) => (
        <li key={`${step.label}-${i}`} className="grid grid-cols-[7rem_1fr_auto] items-baseline gap-x-2">
          <span className="text-muted">{step.label}</span>
          <span className="font-mono tabular-nums">
            {formatSeconds(step.at)}
            {step.note && <span className="ml-1 font-sans text-muted">· {step.note}</span>}
          </span>
          <span className="font-mono tabular-nums text-muted">{i > 0 ? gap(list[i - 1].at, step.at) : ''}</span>
        </li>
      ))}
    </ol>
  )
}
