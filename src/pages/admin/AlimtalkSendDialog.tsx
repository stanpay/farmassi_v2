import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AccountPicker, type ProfileOption } from '../../components/shared/FarmContractFields'
import { Button } from '../../components/ui/Button'
import { ErrorText } from '../../components/ui/Feedback'
import { Input } from '../../components/ui/Field'
import { formatDateTime } from '../../lib/format'
import { invokeFunction } from '../../lib/functions'
import { statusLabels } from '../../lib/orderStatus'
import { supabase } from '../../lib/supabase'
import type { OrderStatus } from '../../types/models'

// 알림톡 수동 발송·재전송 (관리자, 서버 RPC alimtalk-manual).
//
// 템플릿 문구는 알리고에 등록된 그대로라 고칠 수 없다. 고칠 수 있는 건 변수 값뿐이고,
// 받는 사람과 발신 채널은 서버가 주문·회원 정보로 정한다.

interface Template {
  kind: string
  name: string
  code: string
  content: string
  buttons: string[]
  variables: string[]
  target: 'order' | 'user'
}

interface Prepared {
  kind: string
  orderId: string | null
  userId: string | null
  orderNo: string | null
  farmName: string | null
  recipientName: string | null
  recipientPhone: string | null
  variables: Record<string, string>
  /** 주문·회원이 없는 기록의 재전송: 처음 보낸 번호로 간다. */
  fromLog?: boolean
}

interface RecentOrder {
  id: string
  order_no: string
  status: OrderStatus
  created_at: string
  sender_name: string | null
  recipient_name: string | null
  depositor_name: string | null
  farms: { name: string } | null
}

/** 주문번호 고르기: 최신 주문이 드롭다운으로 뜨고, 직접 입력도 된다. */
const RECENT_ORDER_LIMIT = 100

interface SendResult {
  sent: boolean
  skipped?: string
  error?: string
  message?: string
}

/** logId 가 있으면 그 로그를 재전송, 없으면 새로 수동 발송. */
export function AlimtalkSendDialog({
  open,
  logId,
  onClose,
  onSent,
}: {
  open: boolean
  logId: string | null
  onClose: () => void
  onSent: () => void
}) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [kind, setKind] = useState('')
  const [orderNo, setOrderNo] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<ProfileOption[]>([])
  const [recentOrders, setRecentOrders] = useState<RecentOrder[] | null>(null)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)

  const resend = Boolean(logId)
  const template = templates.find((t) => t.kind === kind)

  // 열 때마다 처음 상태로. 재전송이면 그 로그로 바로 채운다.
  useEffect(() => {
    if (!open) return
    setKind('')
    setOrderNo('')
    setUserId(null)
    setPrepared(null)
    setValues({})
    setError('')
    setResult(null)
    let cancelled = false
    void (async () => {
      try {
        const { templates: list } = await invokeFunction<{ templates: Template[] }>('alimtalk-manual', {
          action: 'templates',
        })
        if (cancelled) return
        setTemplates(list)
        if (logId) {
          const data = await invokeFunction<Prepared>('alimtalk-manual', { action: 'prepare', logId })
          if (cancelled) return
          setKind(data.kind)
          setPrepared(data)
          setValues(data.variables)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, logId])

  // 회원가입 안내를 고르면 받을 회원 목록을 읽는다.
  useEffect(() => {
    if (!open || template?.target !== 'user' || profiles.length > 0) return
    void supabase
      .from('profiles')
      .select('id, display_name, phone, avatar_url')
      .order('display_name')
      .then(({ data }) => setProfiles((data as ProfileOption[]) ?? []))
  }, [open, template?.target, profiles.length])

  // 주문 알림 템플릿을 고르면 최신 주문 목록을 읽는다 (드롭다운용).
  useEffect(() => {
    if (!open || template?.target !== 'order' || recentOrders !== null) return
    void supabase
      .from('orders')
      .select('id, order_no, status, created_at, sender_name, recipient_name, depositor_name, farms(name)')
      .order('created_at', { ascending: false })
      .limit(RECENT_ORDER_LIMIT)
      .then(({ data }) => setRecentOrders((data as RecentOrder[]) ?? []))
  }, [open, template?.target, recentOrders])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, pending, onClose])

  async function prepare(target: { orderId?: string; userId?: string }) {
    setError('')
    setResult(null)
    setPrepared(null)
    try {
      const data = await invokeFunction<Prepared>('alimtalk-manual', { action: 'prepare', kind, ...target })
      setPrepared(data)
      setValues(data.variables)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function findOrder() {
    const no = orderNo.trim().toUpperCase()
    if (!no) return
    setError('')
    const { data, error: findError } = await supabase.from('orders').select('id').eq('order_no', no).maybeSingle()
    if (findError) return setError(findError.message)
    if (!data) return setError(`주문번호 ${no} 를 찾지 못했습니다.`)
    await prepare({ orderId: (data as { id: string }).id })
  }

  async function send() {
    if (!prepared) return
    setPending(true)
    setError('')
    setResult(null)
    try {
      const data = await invokeFunction<SendResult>('alimtalk-manual', {
        action: 'send',
        kind,
        orderId: prepared.orderId,
        userId: prepared.userId,
        variables: values,
        resendOf: logId ?? undefined,
      })
      setResult(data)
      if (data.sent) onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  const missing = useMemo(
    () => (template?.variables ?? []).filter((name) => !(values[name] ?? '').trim()),
    [template, values],
  )

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="닫기" disabled={pending} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="alimtalk-send-title"
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-lg"
      >
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 id="alimtalk-send-title" className="text-lg font-bold">
            {resend ? '알림톡 재전송' : '알림톡 수동 발송'}
          </h2>
          <p className="mt-1 text-xs text-muted">템플릿 문구는 고칠 수 없고, 변수 값만 바꿔 보낼 수 있습니다.</p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!resend && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted">템플릿</span>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <button
                    key={t.kind}
                    type="button"
                    aria-pressed={kind === t.kind}
                    onClick={() => {
                      setKind(t.kind)
                      setPrepared(null)
                      setValues({})
                      setUserId(null)
                      setResult(null)
                      setError('')
                    }}
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      kind === t.kind ? 'border-primary bg-primary text-white' : 'border-gray-200 bg-white'
                    }`}
                  >
                    {t.name} <span className="text-xs opacity-70">{t.code}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!resend && template?.target === 'order' && (
            <form
              className="flex items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void findOrder()
              }}
            >
              <div className="flex-1">
                <OrderNoCombobox
                  value={orderNo}
                  onChange={(value) => {
                    setOrderNo(value)
                    // 칸을 고치면 불러온 주문을 내린다. 칸과 다른 주문으로 보내지 않게.
                    if (prepared && value.trim().toUpperCase() !== prepared.orderNo) {
                      setPrepared(null)
                      setResult(null)
                    }
                  }}
                  orders={recentOrders}
                  onPick={(order) => {
                    setOrderNo(order.order_no)
                    void prepare({ orderId: order.id })
                  }}
                />
              </div>
              {/* 목록이 입력칸 아래로 펼쳐져도 버튼은 입력칸 옆에 둔다 (라벨 높이만큼 내림). */}
              <Button type="submit" variant="ghost" className="mt-5">
                불러오기
              </Button>
            </form>
          )}

          {!resend && template?.target === 'user' && (
            <AccountPicker
              label="받을 회원"
              profiles={profiles}
              selectedIds={userId ? [userId] : []}
              onAdd={(id) => {
                setUserId(id)
                void prepare({ userId: id })
              }}
              onRemove={() => {
                setUserId(null)
                setPrepared(null)
              }}
            />
          )}

          {prepared && template && (
            <>
              <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                <dt className="text-muted">템플릿</dt>
                <dd>
                  {template.name} <span className="text-xs text-muted">{template.code}</span>
                </dd>
                <dt className="text-muted">받는 사람</dt>
                <dd>
                  {prepared.recipientName ? `${prepared.recipientName} · ` : ''}
                  {prepared.recipientPhone ?? '휴대폰 번호 없음'}
                  {prepared.fromLog && (
                    <span className="block text-xs text-muted">
                      주문·회원 정보가 없는 기록이라 처음 보냈던 번호로 보냅니다. 변수는 그때 보낸 내용에서 채웠습니다.
                    </span>
                  )}
                </dd>
                {!prepared.orderNo && prepared.farmName && (
                  <>
                    <dt className="text-muted">농가</dt>
                    <dd>{prepared.farmName}</dd>
                  </>
                )}
                {prepared.orderNo && (
                  <>
                    <dt className="text-muted">주문</dt>
                    <dd>
                      {prepared.orderNo} {prepared.farmName && <span className="text-muted">· {prepared.farmName}</span>}
                    </dd>
                  </>
                )}
              </dl>

              <div className="space-y-2">
                <span className="text-xs font-medium text-muted">변수 (자동으로 채움, 고칠 수 있음)</span>
                {template.variables.map((name) => (
                  <Input
                    key={name}
                    label={name}
                    value={values[name] ?? ''}
                    maxLength={200}
                    onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                    aria-invalid={!(values[name] ?? '').trim()}
                  />
                ))}
              </div>

              <div className="space-y-1">
                <span className="text-xs font-medium text-muted">보낼 내용 미리보기</span>
                <Preview content={template.content} values={values} />
                <p className="text-xs text-muted">버튼: {template.buttons.join(', ')}</p>
              </div>
            </>
          )}

          {error && <ErrorText>{error}</ErrorText>}
          {result && (
            <p className={`text-sm ${result.sent ? 'text-primary' : 'text-red-600'}`} role="status">
              {result.sent
                ? '발송을 요청했습니다. 도착 결과는 1분쯤 뒤 로그에 나옵니다.'
                : `보내지 않았습니다: ${result.skipped ?? result.error ?? result.message ?? '알 수 없는 이유'}`}
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-gray-100 px-5 py-4">
          <Button type="button" variant="ghost" fullWidth disabled={pending} onClick={onClose}>
            닫기
          </Button>
          <Button
            type="button"
            fullWidth
            disabled={pending || !prepared || missing.length > 0 || Boolean(result?.sent)}
            onClick={() => void send()}
          >
            {pending ? '보내는 중...' : result?.sent ? '보냄' : resend ? '다시 보내기' : '보내기'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 템플릿 문구에 변수 값을 넣어 보여 준다. 비어 있는 변수는 빨간 #{이름} 으로 남긴다. */
function Preview({ content, values }: { content: string; values: Record<string, string> }) {
  const parts = content.split(/(#\{[^}]+\})/g)
  return (
    <div className="whitespace-pre-wrap rounded-xl border border-gray-200 bg-[#fef9c3]/40 px-3 py-2 text-sm">
      {parts.map((part, i) => {
        const m = /^#\{([^}]+)\}$/.exec(part)
        if (!m) return <span key={i}>{part}</span>
        const value = (values[m[1]] ?? '').trim()
        return value ? (
          <strong key={i} className="font-semibold">
            {value}
          </strong>
        ) : (
          <span key={i} className="text-red-600">
            {part}
          </span>
        )
      })}
    </div>
  )
}

/**
 * 주문번호 입력 + 최신 주문 드롭다운.
 * - 칸을 누르면 최신 주문이 최신순으로 뜬다. 입력하면 주문번호·이름·농가로 걸러진다.
 * - 목록에서 고르면 바로 불러온다. 화살표·Enter 로도 고를 수 있다.
 * - 목록에 없는 (오래된) 주문은 번호를 다 입력하고 Enter 나 '불러오기' (정확히 일치하는 번호로 찾음).
 */
function OrderNoCombobox({
  value,
  onChange,
  orders,
  onPick,
}: {
  value: string
  onChange: (value: string) => void
  orders: RecentOrder[] | null
  onPick: (order: RecentOrder) => void
}) {
  const [show, setShow] = useState(false)
  const [active, setActive] = useState(-1)
  const q = value.trim().toLowerCase()
  const matches = useMemo(() => {
    const list = orders ?? []
    if (!q) return list
    return list.filter((o) =>
      [o.order_no, o.sender_name, o.recipient_name, o.depositor_name, o.farms?.name]
        .some((text) => (text ?? '').toLowerCase().includes(q)),
    )
  }, [orders, q])

  function pick(order: RecentOrder) {
    setShow(false)
    setActive(-1)
    onPick(order)
  }

  return (
    <div>
      <Input
        label="주문번호"
        value={value}
        placeholder="눌러서 최신 주문 고르기, 또는 번호 입력"
        role="combobox"
        aria-expanded={show}
        aria-controls="alimtalk-order-list"
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onChange={(e) => {
          onChange(e.target.value)
          setShow(true)
          setActive(-1)
        }}
        onKeyDown={(e) => {
          // 목록에서 고르지 않고 Enter: 입력한 번호로 찾는다(폼 제출). 목록은 닫는다.
          if (e.key === 'Enter' && active < 0) {
            setShow(false)
            return
          }
          if (!show || matches.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && active >= 0) {
            // 목록에서 고른 상태면 그 주문. 아니면 폼 제출(정확한 번호로 찾기)로 넘긴다.
            e.preventDefault()
            pick(matches[active])
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setShow(false)
          }
        }}
      />
      {show && (
        <ul
          id="alimtalk-order-list"
          role="listbox"
          aria-label="최신 주문"
          // 창 본문이 스크롤 영역이라 띄우면(absolute) 잘린다. 흐름 안에 두어 창이 늘어나게 한다.
          className="mt-1 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm"
        >
          {orders === null ? (
            <li className="px-3 py-2 text-sm text-muted">불러오는 중...</li>
          ) : matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">
              최신 {RECENT_ORDER_LIMIT}건에 없습니다. 번호를 다 입력하고 Enter 를 누르면 찾아봅니다.
            </li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={i === active}
                // 입력칸 blur 보다 먼저 고르도록 mousedown 에서 처리한다.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(o)
                }}
                className={`cursor-pointer border-b border-gray-50 px-3 py-2 text-sm last:border-0 ${
                  i === active ? 'bg-primary/10' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{o.order_no}</span>
                  <span className="text-xs text-muted">{statusLabels[o.status] ?? o.status}</span>
                </div>
                <div className="text-xs text-muted">
                  {[o.farms?.name, o.sender_name || o.depositor_name || o.recipient_name, formatDateTime(o.created_at)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
