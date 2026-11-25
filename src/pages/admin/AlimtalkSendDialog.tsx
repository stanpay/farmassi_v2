import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AccountPicker, type ProfileOption } from '../../components/shared/FarmContractFields'
import { Button } from '../../components/ui/Button'
import { ErrorText } from '../../components/ui/Feedback'
import { Input } from '../../components/ui/Field'
import { invokeFunction } from '../../lib/functions'
import { supabase } from '../../lib/supabase'
import { OrderNoCombobox, RECENT_ORDER_LIMIT, type RecentOrder } from './OrderNoCombobox'

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

interface SendResult {
  sent: boolean
  skipped?: string
  error?: string
  message?: string
}

/**
 * logId 가 있으면 그 로그를 재전송, 없으면 새로 수동 발송.
 * initialKind·initialOrderId 를 주면 그 템플릿·주문으로 바로 채운다 (송장 탭의 알림톡 재전송).
 */
export function AlimtalkSendDialog({
  open,
  logId,
  initialKind,
  initialOrderId,
  onClose,
  onSent,
}: {
  open: boolean
  logId: string | null
  initialKind?: string
  initialOrderId?: string
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
        } else if (initialKind && initialOrderId) {
          setKind(initialKind)
          const data = await invokeFunction<Prepared>('alimtalk-manual', {
            action: 'prepare',
            kind: initialKind,
            orderId: initialOrderId,
          })
          if (cancelled) return
          setPrepared(data)
          setValues(data.variables)
          setOrderNo(data.orderNo ?? '')
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, logId, initialKind, initialOrderId])

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
