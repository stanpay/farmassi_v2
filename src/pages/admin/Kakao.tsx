import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { Header } from '../../components/layout/Header'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { ErrorText, PageSpinner } from '../../components/ui/Feedback'
import { Input, Select, Textarea } from '../../components/ui/Field'
import { adminNavItems } from '../../config/adminNav'
import { invokeFunction } from '../../lib/functions'

// 알리고 알림톡 템플릿 관리. 서버 함수 aligo-templates 를 거친다 (API 키는 서버에만 있다).

type InspStatus = 'REG' | 'REQ' | 'APR' | 'REJ' | string

interface TemplateButton {
  name: string
  linkType: string
  linkMo: string
  linkPc: string
}

interface AlimTemplate {
  code: string
  name: string
  content: string
  status: string
  inspStatus: InspStatus
  createdAt: string
  comments: unknown[]
  buttons: TemplateButton[]
  shared: boolean
  editable: boolean
  deletable: boolean
  requestable: boolean
}

interface Draft {
  mode: 'add' | 'modify'
  code: string
  name: string
  content: string
  buttons: TemplateButton[]
}

const MAX_CONTENT = 1000
const MAX_BUTTONS = 5

const INSP_LABEL: Record<string, { label: string; variant: 'primary' | 'accent' | 'neutral' | 'cold' }> = {
  REG: { label: '등록 (검수 전)', variant: 'neutral' },
  REQ: { label: '검수 중', variant: 'cold' },
  APR: { label: '승인', variant: 'primary' },
  REJ: { label: '반려', variant: 'accent' },
}

const BUTTON_TYPES: { value: string; label: string }[] = [
  { value: 'WL', label: '웹링크' },
  { value: 'AC', label: '채널 추가' },
  { value: 'DS', label: '배송 조회' },
  { value: 'MD', label: '메시지 전달' },
  { value: 'BK', label: '봇 키워드' },
]

const emptyButton = (): TemplateButton => ({ name: '', linkType: 'WL', linkMo: 'https://', linkPc: '' })

function variablesOf(text: string) {
  return Array.from(new Set(text.match(/#\{[^}]+\}/g) ?? []))
}

function commentText(comment: unknown) {
  if (typeof comment === 'string') return comment
  if (comment && typeof comment === 'object') {
    const c = comment as Record<string, unknown>
    return String(c.content ?? c.comment ?? c.message ?? JSON.stringify(c))
  }
  return String(comment)
}

export function AdminKakao() {
  const [templates, setTemplates] = useState<AlimTemplate[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [viewing, setViewing] = useState<AlimTemplate | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AlimTemplate | null>(null)

  async function load() {
    setLoadError('')
    try {
      const res = await invokeFunction<{ templates: AlimTemplate[] }>('aligo-templates', { action: 'list' })
      setTemplates(res.templates)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '템플릿을 불러오지 못했습니다.')
      setTemplates([])
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = templates ?? []
    return q
      ? list.filter((t) => `${t.name} ${t.code} ${t.content}`.toLowerCase().includes(q))
      : list
  }, [templates, query])

  function openTemplate(t: AlimTemplate) {
    setError('')
    setNotice('')
    if (t.editable) {
      setViewing(null)
      setDraft({ mode: 'modify', code: t.code, name: t.name, content: t.content, buttons: t.buttons.map((b) => ({ ...b })) })
    } else {
      setDraft(null)
      setViewing(t)
    }
  }

  function startNew(from?: AlimTemplate) {
    setError('')
    setNotice('')
    setViewing(null)
    setDraft({
      mode: 'add',
      code: '',
      name: from ? `${from.name} (수정본)`.slice(0, 30) : '',
      content: from?.content ?? '',
      buttons: from?.buttons.map((b) => ({ ...b })) ?? [],
    })
  }

  async function run(action: string, body: Record<string, unknown>, success: string) {
    setError('')
    setNotice('')
    setPending(true)
    try {
      await invokeFunction('aligo-templates', { action, ...body })
      setNotice(success)
      await load()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청에 실패했습니다.')
      return false
    } finally {
      setPending(false)
    }
  }

  async function save() {
    if (!draft) return
    const ok = await run(
      draft.mode,
      { code: draft.code || undefined, name: draft.name, content: draft.content, buttons: draft.buttons },
      draft.mode === 'add' ? '새 템플릿을 등록했습니다. 검수 요청을 해야 발송에 쓸 수 있습니다.' : '템플릿을 저장했습니다.',
    )
    if (ok) setDraft(null)
  }

  const editor = draft && (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-bold">{draft.mode === 'add' ? '새 템플릿' : `템플릿 수정 · ${draft.code}`}</p>
        <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
          닫기
        </Button>
      </div>
      <Input
        label="템플릿 이름"
        value={draft.name}
        maxLength={30}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        placeholder="예: 입금 확인 안내"
      />
      <div className="space-y-1">
        <Textarea
          label="내용"
          rows={10}
          value={draft.content}
          maxLength={MAX_CONTENT}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          placeholder={'#{고객명}님, 주문하신 #{상품명} 입금이 확인되었습니다.'}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            바뀌는 값은 <code>#{'{'}변수명{'}'}</code> 으로 씁니다.
            {variablesOf(draft.content).length > 0 && ` 사용 중: ${variablesOf(draft.content).join(' ')}`}
          </span>
          <span>
            {draft.content.length}/{MAX_CONTENT}
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">버튼</p>
          <Button
            size="sm"
            variant="outline"
            disabled={draft.buttons.length >= MAX_BUTTONS}
            onClick={() => setDraft({ ...draft, buttons: [...draft.buttons, emptyButton()] })}
          >
            버튼 추가
          </Button>
        </div>
        {draft.buttons.length === 0 && <p className="text-xs text-muted">버튼 없음</p>}
        {draft.buttons.map((b, i) => {
          const update = (patch: Partial<TemplateButton>) =>
            setDraft({ ...draft, buttons: draft.buttons.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
          return (
            <div key={i} className="space-y-2 rounded-xl border border-gray-200 p-3">
              <div className="grid grid-cols-2 gap-2">
                <Input label="버튼 이름" value={b.name} maxLength={14} onChange={(e) => update({ name: e.target.value })} />
                <Select label="종류" value={b.linkType} onChange={(e) => update({ linkType: e.target.value })}>
                  {BUTTON_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </div>
              {b.linkType === 'WL' && (
                <>
                  <Input label="모바일 링크" value={b.linkMo} onChange={(e) => update({ linkMo: e.target.value })} />
                  <Input
                    label="PC 링크 (비우면 모바일과 같음)"
                    value={b.linkPc}
                    onChange={(e) => update({ linkPc: e.target.value })}
                  />
                </>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft({ ...draft, buttons: draft.buttons.filter((_, j) => j !== i) })}
                >
                  버튼 삭제
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <Preview content={draft.content} buttons={draft.buttons} />

      {draft.mode === 'modify' && (
        <p className="text-xs text-muted">저장해도 검수는 다시 요청해야 합니다. 검수는 보통 4~5일 걸립니다.</p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex gap-2">
        <Button disabled={pending || !draft.name.trim() || !draft.content.trim()} onClick={() => void save()}>
          {draft.mode === 'add' ? '등록' : '저장'}
        </Button>
        <Button variant="ghost" onClick={() => setDraft(null)}>
          취소
        </Button>
      </div>
    </Card>
  )

  const viewer = viewing && (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-bold">
          {viewing.name} <span className="text-xs font-normal text-muted">{viewing.code}</span>
        </p>
        <Button size="sm" variant="ghost" onClick={() => setViewing(null)}>
          닫기
        </Button>
      </div>
      <p className="text-sm text-muted">
        {viewing.shared
          ? '알리고 공유 템플릿이라 고칠 수 없습니다.'
          : viewing.inspStatus === 'APR'
            ? '승인된 템플릿은 카카오 규칙상 고칠 수 없습니다. 복사해서 새 템플릿으로 등록한 뒤 다시 검수받아야 합니다.'
            : '검수 중인 템플릿은 고칠 수 없습니다. 결과가 나온 뒤(반려되면) 고칠 수 있습니다.'}
      </p>
      <Preview content={viewing.content} buttons={viewing.buttons} />
      {!viewing.shared && (
        <Button size="sm" variant="outline" onClick={() => startNew(viewing)}>
          복사해서 새 템플릿 만들기
        </Button>
      )}
    </Card>
  )

  return (
    <AppShell navItems={adminNavItems} roleLabel="관리자" settingsPath="/admin/none">
      <Header title="카카오톡" subtitle="알림톡 템플릿" />
      <div className="px-4 py-4 md:px-6 max-w-3xl mx-auto space-y-4">
        <div className="flex justify-end">
          <Link to="/admin/kakao/logs" className="text-sm text-primary underline">
            발송 로그 보기 →
          </Link>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="템플릿 검색"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="템플릿 이름, 코드, 내용 검색"
            />
          </div>
          <Button onClick={() => startNew()}>새 템플릿</Button>
        </div>

        {notice && <p className="rounded-xl bg-primary-light px-3 py-2 text-sm text-primary">{notice}</p>}
        {!draft && error && <ErrorText>{error}</ErrorText>}
        {editor}
        {viewer}

        {templates === null ? (
          <PageSpinner label="템플릿 불러오는 중..." />
        ) : loadError ? (
          <ErrorText>{loadError}</ErrorText>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted">{query ? '일치하는 템플릿이 없습니다.' : '등록된 템플릿이 없습니다.'}</p>
        ) : (
          visible.map((t) => {
            const insp = INSP_LABEL[t.inspStatus] ?? { label: t.inspStatus || '알 수 없음', variant: 'neutral' as const }
            return (
              <Card key={t.code} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">{t.name}</p>
                  <Badge variant={insp.variant}>{insp.label}</Badge>
                  {t.status === 'S' && <Badge variant="accent">중단</Badge>}
                  {t.shared && <Badge variant="neutral">공유</Badge>}
                  <span className="text-xs text-muted">{t.code}</span>
                </div>
                <p className="line-clamp-3 whitespace-pre-line text-sm text-gray-700">{t.content}</p>
                {t.inspStatus === 'REJ' && t.comments.length > 0 && (
                  <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <p className="font-semibold">반려 사유</p>
                    {t.comments.map((c, i) => (
                      <p key={i} className="whitespace-pre-line">
                        {commentText(c)}
                      </p>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openTemplate(t)}>
                    {t.editable ? '수정' : '보기'}
                  </Button>
                  {t.requestable && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => void run('request', { code: t.code }, `${t.name} 검수를 요청했습니다.`)}
                    >
                      검수 요청
                    </Button>
                  )}
                  {t.deletable && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDeleteTarget(t)}>
                      삭제
                    </Button>
                  )}
                </div>
              </Card>
            )
          })
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="템플릿을 삭제할까요?"
        description={deleteTarget ? `${deleteTarget.name} (${deleteTarget.code}) — 알리고에서 바로 지워지고 되돌릴 수 없습니다.` : undefined}
        confirmLabel="삭제"
        pending={pending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return
          const target = deleteTarget
          const ok = await run('delete', { code: target.code }, `${target.name} 템플릿을 삭제했습니다.`)
          if (ok) {
            setDeleteTarget(null)
            if (draft?.code === target.code) setDraft(null)
          }
        }}
      />
    </AppShell>
  )
}

function Preview({ content, buttons }: { content: string; buttons: TemplateButton[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted">미리보기</p>
      <div className="max-w-xs rounded-2xl bg-[#b2c7d9] p-3">
        <div className="overflow-hidden rounded-xl bg-white">
          <div className="bg-[#fee500] px-3 py-2 text-xs font-bold text-gray-900">알림톡 도착</div>
          <p className="whitespace-pre-line break-words px-3 py-3 text-sm text-gray-900">
            {content || <span className="text-muted">내용을 입력하세요</span>}
          </p>
          {buttons.length > 0 && (
            <div className="space-y-1.5 px-3 pb-3">
              {buttons.map((b, i) => (
                <div key={i} className="rounded-lg bg-gray-100 py-2 text-center text-xs font-medium text-gray-800">
                  {b.name || '버튼'}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
