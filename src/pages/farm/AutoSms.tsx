import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  BatteryCharging,
  Check,
  MessageSquareText,
  Plus,
  Smartphone,
  Trash2,
} from 'lucide-react'
import { Header } from '../../components/layout/Header'
import { FarmSharePreview } from '../../components/shared/FarmSharePreview'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { ErrorText } from '../../components/ui/Feedback'
import { Input } from '../../components/ui/Field'
import { PhoneField } from '../../components/ui/PhoneField'
import {
  clearAutoSmsHistory,
  isAutoSmsNative,
  loadAutoSmsConfig,
  loadAutoSmsHistory,
  loadAutoSmsStatus,
  openBatteryOptimizationSettings,
  openOverlaySettings,
  listDeviceContacts,
  pickExclusionContact,
  requestAutoSmsPermissions,
  requestContactsPermission,
  saveAutoSmsConfig,
  sendAutoSmsTest,
  type AutoSmsHistoryItem,
  type AutoSmsStatus,
} from '../../lib/autoSms'
import {
  CALL_EVENT_LABEL,
  CALL_EVENTS,
  FREQUENCY_LABEL,
  FREQUENCIES,
  WEEKDAY_LABEL,
  WEEKDAYS,
  describeRule,
  emptyRule,
  findOverlaps,
  parseAutoSmsStored,
  smsKind,
  storedFromConfig,
  type AutoSmsConfig,
  type AutoSmsRule,
  type CallEvent,
  type Frequency,
  type Weekday,
} from '../../lib/callbackRules'
import { useFarmWorkspace } from '../../lib/farmWorkspace'
import { resolveFarmShareText, type FarmShareInput } from '../../lib/farmShareText'
import { formatPhone, normalizePhone, normalizePhoneDigits } from '../../lib/phone'
import { supabase } from '../../lib/supabase'

const HISTORY_STATUS: Record<AutoSmsHistoryItem['status'], string> = {
  sending: '보내는 중',
  sent: '보냄',
  failed: '실패',
  skipped: '안 보냄',
}

const SKIP_REASON: Record<string, string> = {
  no_number: '번호를 모름',
  not_mobile: '휴대폰이 아님',
  excluded: '제외 번호',
  no_message: '문구 없음',
  auto_off: '자동 발신 꺼짐',
  no_rule: '맞는 규칙 없음',
  frequency: '같은 번호 재발송 제한',
  popup_timeout: '팝업에서 시간 초과',
  popup_dismissed: '팝업에서 닫음',
  popup_failed: '팝업을 띄우지 못함',
  no_permission: '문자 권한 없음',
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-gray-200'
      }`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
        selected ? 'bg-primary text-white' : 'bg-white text-gray-600 border border-gray-200'
      }`}
    >
      {children}
    </button>
  )
}

export function FarmAutoSms() {
  const { farm, refreshFarm } = useFarmWorkspace()
  const native = isAutoSmsNative()
  const shareInput: FarmShareInput = useMemo(
    () => ({
      name: farm.name,
      slug: farm.slug,
      description: farm.description,
      product_summary: farm.product_summary,
      phone: farm.phone,
      mobile_phone: farm.mobile_phone,
      address: farm.address,
      address_zonecode: farm.address_zonecode,
      address_detail: farm.address_detail,
      map_url: farm.map_url,
    }),
    [farm],
  )

  const [shareText, setShareText] = useState(farm.share_text ?? '')
  const [config, setConfig] = useState<AutoSmsConfig | null>(null)
  const [status, setStatus] = useState<AutoSmsStatus | null>(null)
  const [history, setHistory] = useState<AutoSmsHistoryItem[]>([])
  const [tab, setTab] = useState<'rules' | 'exclusions' | 'history'>('rules')
  const [editing, setEditing] = useState<AutoSmsRule | null>(null)
  const [overlaps, setOverlaps] = useState<ReturnType<typeof findOverlaps>>([])
  const [pendingRule, setPendingRule] = useState<AutoSmsRule | null>(null)
  const [testPhone, setTestPhone] = useState('')
  const [exclusionPhone, setExclusionPhone] = useState('')
  const [exclusionName, setExclusionName] = useState('')
  const [contactPickerOpen, setContactPickerOpen] = useState(false)
  const [deviceContacts, setDeviceContacts] = useState<Array<{ name: string; phone: string }>>([])
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set())
  const [contactQuery, setContactQuery] = useState('')
  const [contactsLoading, setContactsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const resolvedMessage = resolveFarmShareText({ ...shareInput, share_text: shareText })
  const kind = smsKind(resolvedMessage)

  const savedMessage = useMemo(
    () => resolveFarmShareText({ ...shareInput, share_text: farm.share_text }),
    [shareInput, farm.share_text],
  )
  const autoSmsKey = JSON.stringify(farm.auto_sms ?? {})

  const refreshNative = useCallback(async () => {
    if (!native) return
    const [nextStatus, nextHistory] = await Promise.all([loadAutoSmsStatus(), loadAutoSmsHistory()])
    setStatus(nextStatus)
    setHistory(nextHistory)
  }, [native])

  useEffect(() => {
    setShareText(farm.share_text ?? '')
  }, [farm.share_text])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const fromDb = parseAutoSmsStored(JSON.parse(autoSmsKey) as unknown, savedMessage)
      if (native) {
        const device = await loadAutoSmsConfig(savedMessage)
        if (cancelled) return
        const merged = { ...fromDb, master: device.master, message: savedMessage }
        setConfig(merged)
        await saveAutoSmsConfig(merged)
        await refreshNative()
      } else {
        setConfig(fromDb)
      }
    })().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : '설정을 읽지 못했습니다.')
    })
    return () => {
      cancelled = true
    }
  }, [autoSmsKey, native, refreshNative, savedMessage])

  async function persistConfig(next: AutoSmsConfig) {
    setConfig(next)
    const { error: updateError } = await supabase
      .from('farms')
      .update({ auto_sms: storedFromConfig(next) })
      .eq('id', farm.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await refreshFarm()
    if (native) await saveAutoSmsConfig({ ...next, message: savedMessage })
  }

  async function persistMaster(master: boolean) {
    if (!config || !native) return
    const next = { ...config, master }
    setConfig(next)
    await saveAutoSmsConfig({ ...next, message: savedMessage })
  }

  async function saveShareText() {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const text = resolveFarmShareText({ ...shareInput, share_text: shareText }) || null
      const { error: updateError } = await supabase.from('farms').update({ share_text: text }).eq('id', farm.id)
      if (updateError) throw updateError
      await refreshFarm()
      if (native && config) await saveAutoSmsConfig({ ...config, message: text ?? '' })
      setMessage('문자 내용을 저장했습니다.')
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  function askSaveRule(rule: AutoSmsRule) {
    if (!config) return
    const nextRules = config.rules.some((row) => row.id === rule.id)
      ? config.rules.map((row) => (row.id === rule.id ? rule : row))
      : [...config.rules, rule]
    const hits = findOverlaps(nextRules).filter((row) => row.aId === rule.id || row.bId === rule.id)
    if (hits.length > 0) {
      setPendingRule(rule)
      setOverlaps(hits)
      return
    }
    void persistConfig({ ...config, rules: nextRules })
    setEditing(null)
  }

  async function confirmOverlappedRule() {
    if (!config || !pendingRule) return
    const rule = pendingRule
    const nextRules = config.rules.some((row) => row.id === rule.id)
      ? config.rules.map((row) => (row.id === rule.id ? rule : row))
      : [...config.rules, rule]
    await persistConfig({ ...config, rules: nextRules })
    setPendingRule(null)
    setOverlaps([])
    setEditing(null)
  }

  async function addExclusion() {
    if (!config) return
    const phone = normalizePhoneDigits(exclusionPhone)
    if (phone.length < 10) {
      setError('휴대폰 번호를 입력해 주세요.')
      return
    }
    if (config.exclusions.some((row) => row.phone === phone)) {
      setError('이미 제외된 번호입니다.')
      return
    }
    await persistConfig({
      ...config,
      exclusions: [...config.exclusions, { name: exclusionName.trim() || phone, phone }],
    })
    setExclusionPhone('')
    setExclusionName('')
    setError('')
  }

  async function openContactPicker() {
    if (!config || !native) return
    setError('')
    setContactsLoading(true)
    setContactPickerOpen(true)
    setContactQuery('')
    try {
      const items = await listDeviceContacts()
      setDeviceContacts(items)
      setSelectedContacts(new Set(items.filter((row) => config.exclusions.some((ex) => ex.phone === row.phone)).map((row) => row.phone)))
      await refreshNative()
    } catch (err) {
      setContactPickerOpen(false)
      setError(err instanceof Error ? err.message : '주소록을 읽지 못했습니다.')
    } finally {
      setContactsLoading(false)
    }
  }

  async function excludeAllContacts() {
    if (!config || !native) return
    setError('')
    setContactsLoading(true)
    try {
      const items = await listDeviceContacts()
      const already = new Set(config.exclusions.map((row) => row.phone))
      const extra = items.filter((row) => !already.has(row.phone))
      if (extra.length === 0) {
        setMessage(items.length === 0 ? '주소록에 휴대폰 번호가 없습니다.' : '주소록 번호는 이미 모두 제외되어 있습니다.')
        return
      }
      await persistConfig({ ...config, exclusions: [...config.exclusions, ...extra] })
      setMessage(`주소록 ${extra.length}명을 제외했습니다.`)
      await refreshNative()
    } catch (err) {
      setError(err instanceof Error ? err.message : '주소록을 읽지 못했습니다.')
    } finally {
      setContactsLoading(false)
    }
  }

  async function applyContactSelection() {
    if (!config) return
    const inBook = new Set(deviceContacts.map((row) => row.phone))
    const kept = config.exclusions.filter((row) => !inBook.has(row.phone))
    const picked = deviceContacts.filter((row) => selectedContacts.has(row.phone))
    await persistConfig({ ...config, exclusions: [...kept, ...picked] })
    setContactPickerOpen(false)
    setMessage(`제외 번호를 ${picked.length}명으로 맞췄습니다.`)
  }

  return (
    <>
      <Header title="자동문자" subtitle={farm.name} />
      <div className="px-4 py-4 md:px-6 max-w-5xl mx-auto space-y-3">
        <Card className="space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">문자 내용</h3>
            <Badge variant="neutral">
              {kind.kind} {kind.bytes}바이트
            </Badge>
          </div>
          <p className="text-sm text-muted">
            관리자 농가 화면의 안내 문자와 같습니다. 전화가 끝나면 이 문구를 그대로 보냅니다.
          </p>
          <FarmSharePreview farm={shareInput} value={shareText} onChange={setShareText} />
          <ErrorText>{error}</ErrorText>
          {message ? <p className="text-sm text-primary">{message}</p> : null}
          <Button type="button" disabled={saving} onClick={() => void saveShareText()}>
            {saving ? '저장 중…' : '문자 내용 저장'}
          </Button>
        </Card>

        {native && status ? (
          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">자동 발신</h3>
                <p className="text-xs text-muted">
                  {config?.master
                    ? '규칙에 맞으면 통화가 끝나는 즉시 보냅니다.'
                    : '자동 발신이 꺼져 있습니다. 직접 고르지 않으면 아무것도 보내지 않습니다.'}
                </p>
              </div>
              <Toggle
                checked={Boolean(config?.master)}
                label="자동 발신"
                onChange={(master) => void persistMaster(master)}
              />
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>자동 발신이 꺼져 있으면 선택 팝업 띄우기</span>
              <Toggle
                checked={Boolean(config?.popupWhenOff)}
                label="선택 팝업"
                onChange={(popupWhenOff) => config && void persistConfig({ ...config, popupWhenOff })}
              />
            </label>
            <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-sm">
              <StatusRow
                ok={status.phone}
                label="전화·통화기록"
                action="권한 허용"
                onClick={() => void requestAutoSmsPermissions().then(refreshNative)}
              />
              <StatusRow
                ok={status.sms}
                label="문자 보내기"
                action="권한 허용"
                onClick={() => void requestAutoSmsPermissions().then(refreshNative)}
              />
              <StatusRow
                ok={status.overlay}
                label="다른 앱 위에 표시"
                action="설정 열기"
                onClick={() => void openOverlaySettings()}
              />
              <StatusRow
                ok={Boolean(status.contacts)}
                label="주소록"
                action="권한 허용"
                onClick={() => void requestContactsPermission().then(refreshNative)}
              />
              <StatusRow
                ok={status.batteryUnrestricted}
                label="배터리 최적화 해제"
                action="설정 열기"
                icon={<BatteryCharging className="h-4 w-4" />}
                onClick={() => void openBatteryOptimizationSettings().then(refreshNative)}
              />
            </div>
            <p className="text-xs text-muted">
              삼성 등 제조사 절전은 별도로 해제해야 합니다. 앱을 강제 종료하면 자동 감지가 멈춥니다.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1">
                <PhoneField label="테스트 발송" value={testPhone} onChange={setTestPhone} />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  setError('')
                  setMessage('')
                  try {
                    await sendAutoSmsTest(normalizePhone(testPhone) || testPhone)
                    setMessage('테스트 문자를 보냈습니다.')
                    await refreshNative()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '테스트 발송에 실패했습니다.')
                  }
                }}
              >
                보내기
              </Button>
            </div>
          </Card>
        ) : null}

        {config ? (
          <>
            {!native ? (
              <Card className="space-y-3">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">자동 발신</h3>
                </div>
                <p className="text-sm text-muted">
                  규칙과 제외 번호는 여기서 저장됩니다. 실제로 보내려면 안드로이드 앱에서 자동 발신을 켜 주세요.
                </p>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>자동 발신이 꺼져 있으면 선택 팝업 띄우기</span>
                  <Toggle
                    checked={config.popupWhenOff}
                    label="선택 팝업"
                    onChange={(popupWhenOff) => void persistConfig({ ...config, popupWhenOff })}
                  />
                </label>
              </Card>
            ) : null}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(
                [
                  ['rules', '규칙'],
                  ['exclusions', '제외 번호'],
                  ...(native ? [['history', '전송 이력']] : []),
                ] as Array<['rules' | 'exclusions' | 'history', string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
                    tab === id ? 'bg-primary text-white' : 'bg-white text-gray-600 border border-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'rules' ? (
              <Card className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">규칙</h3>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(emptyRule())}>
                    <Plus className="h-4 w-4" />
                    규칙 추가
                  </Button>
                </div>
                <p className="text-xs text-muted">위에 있는 규칙이 먼저 적용됩니다. 첫 번째로 맞는 규칙만 보냅니다.</p>
                {config.rules.length === 0 ? <p className="text-sm text-muted">규칙이 없습니다.</p> : null}
                <ul className="space-y-2">
                  {config.rules.map((rule, index) => (
                    <li key={rule.id} className="rounded-xl border border-gray-100 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <button type="button" className="text-left min-w-0" onClick={() => setEditing(rule)}>
                          <p className="font-medium">{rule.name || '이름 없는 규칙'}</p>
                          <p className="text-xs text-muted">{describeRule(rule)}</p>
                        </button>
                        <Toggle
                          checked={rule.enabled}
                          label={`${rule.name} 사용`}
                          onChange={(enabled) =>
                            void persistConfig({
                              ...config,
                              rules: config.rules.map((row) => (row.id === rule.id ? { ...row, enabled } : row)),
                            })
                          }
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={index === 0}
                          onClick={() => {
                            const next = [...config.rules]
                            ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                            void persistConfig({ ...config, rules: next })
                          }}
                        >
                          위로
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={index === config.rules.length - 1}
                          onClick={() => {
                            const next = [...config.rules]
                            ;[next[index + 1], next[index]] = [next[index], next[index + 1]]
                            void persistConfig({ ...config, rules: next })
                          }}
                        >
                          아래로
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void persistConfig({
                              ...config,
                              rules: config.rules.filter((row) => row.id !== rule.id),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                          삭제
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {tab === 'exclusions' ? (
              <Card className="space-y-3">
                <h3 className="font-semibold">제외 번호</h3>
                <p className="text-xs text-muted">
                  지역번호와 070은 자동으로 보내지 않습니다. 주소록에 있는 사람에게는 보내지 않으려면 아래에서 고르면
                  됩니다.
                </p>
                {native ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" disabled={contactsLoading} onClick={() => void openContactPicker()}>
                      {contactsLoading ? '불러오는 중…' : '주소록에서 고르기'}
                    </Button>
                    <Button type="button" variant="ghost" disabled={contactsLoading} onClick={() => void excludeAllContacts()}>
                      주소록 모두 제외
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted">주소록 목록은 안드로이드 앱에서 불러올 수 있습니다. 웹에서는 번호를 직접 넣을 수 있습니다.</p>
                )}
                <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <Input label="이름" value={exclusionName} onChange={(e) => setExclusionName(e.target.value)} />
                  <PhoneField label="번호" value={exclusionPhone} onChange={setExclusionPhone} />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => void addExclusion()}>
                      추가
                    </Button>
                    {native ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={async () => {
                          const contact = await pickExclusionContact()
                          if (!contact) return
                          setExclusionName(contact.name)
                          setExclusionPhone(contact.phone)
                        }}
                      >
                        한 명 고르기
                      </Button>
                    ) : null}
                  </div>
                </div>
                {config.exclusions.length === 0 ? <p className="text-sm text-muted">제외 번호가 없습니다.</p> : null}
                <ul className="space-y-2">
                  {config.exclusions.map((row) => (
                    <li key={row.phone} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{row.name}</p>
                        <p className="text-xs text-muted">{row.phone}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void persistConfig({
                            ...config,
                            exclusions: config.exclusions.filter((item) => item.phone !== row.phone),
                          })
                        }
                      >
                        삭제
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {tab === 'history' ? (
              <Card className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">전송 이력</h3>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void clearAutoSmsHistory().then(refreshNative)}>
                    비우기
                  </Button>
                </div>
                {history.length === 0 ? <p className="text-sm text-muted">이력이 없습니다.</p> : null}
                <ul className="space-y-2">
                  {history.map((row) => (
                    <li key={row.id} className="rounded-xl border border-gray-100 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{row.number || '(번호 없음)'}</p>
                        <Badge variant={row.status === 'sent' ? 'primary' : row.status === 'failed' ? 'accent' : 'neutral'}>
                          {HISTORY_STATUS[row.status]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted">
                        {new Date(row.createdAt).toLocaleString('ko-KR')} · {CALL_EVENT_LABEL[row.event as CallEvent] ?? row.event}
                        {row.ruleName ? ` · ${row.ruleName}` : ''}
                      </p>
                      {row.reason ? (
                        <p className="mt-1 text-xs text-muted">{SKIP_REASON[row.reason] ?? row.reason}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>

      {contactPickerOpen ? (
        <ContactPicker
          loading={contactsLoading}
          contacts={deviceContacts}
          selected={selectedContacts}
          query={contactQuery}
          onQuery={setContactQuery}
          onToggle={(phone) => {
            setSelectedContacts((prev) => {
              const next = new Set(prev)
              if (next.has(phone)) next.delete(phone)
              else next.add(phone)
              return next
            })
          }}
          onSelectVisible={(phones) => setSelectedContacts(new Set(phones))}
          onCancel={() => setContactPickerOpen(false)}
          onSave={() => void applyContactSelection()}
        />
      ) : null}

      {editing ? (
        <RuleEditor
          rule={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() => askSaveRule(editing)}
        />
      ) : null}

      <ConfirmDialog
        open={overlaps.length > 0}
        title="겹치는 규칙이 있습니다"
        description={
          <ul className="space-y-2">
            {overlaps.map((row) => (
              <li key={`${row.aId}-${row.bId}`}>
                <p>
                  «{row.aName}» 과 «{row.bName}»
                </p>
                <p>
                  {row.events.map((event) => CALL_EVENT_LABEL[event]).join('·')} ·{' '}
                  {row.days.map((day) => WEEKDAY_LABEL[day]).join('')} · {row.time}
                </p>
              </li>
            ))}
            <li>목록에서 위에 있는 규칙이 먼저 적용됩니다. 그래도 저장할까요?</li>
          </ul>
        }
        confirmLabel="저장"
        onCancel={() => {
          setPendingRule(null)
          setOverlaps([])
        }}
        onConfirm={() => void confirmOverlappedRule()}
      />
    </>
  )
}

function StatusRow({
  ok,
  label,
  action,
  onClick,
  icon,
}: {
  ok: boolean
  label: string
  action: string
  onClick: () => void
  icon?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2">
        {ok ? <Check className="h-4 w-4 text-primary" /> : icon ?? <AlertTriangle className="h-4 w-4 text-amber-600" />}
        {label}
      </span>
      {ok ? (
        <span className="text-xs text-primary">허용됨</span>
      ) : (
        <Button type="button" size="sm" variant="outline" onClick={onClick}>
          {action}
        </Button>
      )}
    </div>
  )
}

function RuleEditor({
  rule,
  onChange,
  onCancel,
  onSave,
}: {
  rule: AutoSmsRule
  onChange: (next: AutoSmsRule) => void
  onCancel: () => void
  onSave: () => void
}) {
  function toggleEvent(event: CallEvent) {
    const events = rule.events.includes(event)
      ? rule.events.filter((item) => item !== event)
      : [...rule.events, event]
    onChange({ ...rule, events })
  }

  function toggleDay(day: Weekday) {
    const days = rule.days.includes(day) ? rule.days.filter((item) => item !== day) : [...rule.days, day]
    onChange({ ...rule, days: days.sort((a, b) => a - b) as Weekday[] })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center p-0 md:p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="닫기" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-editor-title"
        className="relative w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl md:rounded-2xl bg-white p-5 shadow-lg space-y-4"
      >
        <h2 id="rule-editor-title" className="text-lg font-bold">
          규칙
        </h2>
        <Input label="이름" value={rule.name} onChange={(e) => onChange({ ...rule, name: e.target.value })} />
        <div>
          <p className="text-xs font-medium text-muted">어떤 상황에</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {CALL_EVENTS.map((event) => (
              <Chip key={event} selected={rule.events.includes(event)} onClick={() => toggleEvent(event)}>
                {CALL_EVENT_LABEL[event]}
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted">요일</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Chip
              selected={rule.days.length === 5 && WEEKDAYS.slice(1, 6).every((day) => rule.days.includes(day))}
              onClick={() => onChange({ ...rule, days: [1, 2, 3, 4, 5] })}
            >
              평일
            </Chip>
            <Chip
              selected={rule.days.length === 2 && rule.days.includes(0) && rule.days.includes(6)}
              onClick={() => onChange({ ...rule, days: [0, 6] })}
            >
              주말
            </Chip>
            <Chip
              selected={rule.days.length === 7}
              onClick={() => onChange({ ...rule, days: [...WEEKDAYS] })}
            >
              매일
            </Chip>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => (
              <Chip key={day} selected={rule.days.includes(day)} onClick={() => toggleDay(day)}>
                {WEEKDAY_LABEL[day]}
              </Chip>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-muted">시작</span>
            <input
              type="time"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm"
              value={rule.start}
              onChange={(e) => onChange({ ...rule, start: e.target.value || '00:00' })}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted">끝</span>
            <input
              type="time"
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm"
              value={rule.end}
              onChange={(e) => onChange({ ...rule, end: e.target.value || '00:00' })}
            />
          </label>
        </div>
        <p className="text-xs text-muted">시작과 끝을 같게 두면 하루 종일입니다. 시작이 더 늦으면 자정을 넘깁니다.</p>
        <div>
          <p className="text-xs font-medium text-muted">같은 번호에 얼마나 자주</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {FREQUENCIES.map((item) => (
              <Chip
                key={item}
                selected={rule.frequency === item}
                onClick={() => onChange({ ...rule, frequency: item as Frequency })}
              >
                {FREQUENCY_LABEL[item]}
              </Chip>
            ))}
          </div>
        </div>
        {rule.frequency === 'days' ? (
          <Input
            label="며칠마다"
            type="number"
            min={1}
            value={String(rule.frequencyDays)}
            onChange={(e) => onChange({ ...rule, frequencyDays: Math.max(1, Number(e.target.value) || 1) })}
          />
        ) : null}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" fullWidth onClick={onCancel}>
            취소
          </Button>
          <Button type="button" fullWidth onClick={onSave} disabled={rule.events.length === 0 || rule.days.length === 0}>
            저장
          </Button>
        </div>
      </div>
    </div>
  )
}

function ContactPicker({
  loading,
  contacts,
  selected,
  query,
  onQuery,
  onToggle,
  onSelectVisible,
  onCancel,
  onSave,
}: {
  loading: boolean
  contacts: Array<{ name: string; phone: string }>
  selected: Set<string>
  query: string
  onQuery: (value: string) => void
  onToggle: (phone: string) => void
  onSelectVisible: (phones: string[]) => void
  onCancel: () => void
  onSave: () => void
}) {
  const needle = query.trim().toLowerCase()
  const visible = contacts.filter((row) => {
    if (!needle) return true
    return row.name.toLowerCase().includes(needle) || row.phone.includes(needle.replace(/\D/g, ''))
  })

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center p-0 md:p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="닫기" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-picker-title"
        className="relative w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden rounded-t-2xl md:rounded-2xl bg-white p-5 shadow-lg"
      >
        <h2 id="contact-picker-title" className="text-lg font-bold">
          주소록에서 고르기
        </h2>
        <p className="mt-1 text-sm text-muted">체크한 사람에게는 콜백문자를 보내지 않습니다. 휴대폰 번호만 나옵니다.</p>
        <Input
          label="검색"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="이름 또는 번호"
        />
        <div className="mt-2 flex items-center justify-between text-sm">
          <span className="text-muted">
            {loading ? '불러오는 중…' : `${selected.size}명 선택 · ${visible.length}명 표시`}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onSelectVisible(visible.map((row) => row.phone))}>
            보이는 번호 모두 선택
          </Button>
        </div>
        <ul className="mt-2 min-h-0 flex-1 overflow-y-auto divide-y divide-gray-100">
          {visible.map((row) => {
            const checked = selected.has(row.phone)
            return (
              <li key={row.phone}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-1 py-2.5 text-left"
                  onClick={() => onToggle(row.phone)}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      checked ? 'border-primary bg-primary text-white' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {checked ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{row.name}</span>
                    <span className="block text-xs text-muted">{formatPhone(row.phone) || row.phone}</span>
                  </span>
                </button>
              </li>
            )
          })}
          {!loading && visible.length === 0 ? (
            <li className="px-1 py-6 text-sm text-muted">해당하는 연락처가 없습니다.</li>
          ) : null}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" fullWidth onClick={onCancel}>
            취소
          </Button>
          <Button type="button" fullWidth disabled={loading} onClick={onSave}>
            제외 목록에 반영
          </Button>
        </div>
      </div>
    </div>
  )
}
