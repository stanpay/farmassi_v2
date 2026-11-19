import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Copy, Package } from 'lucide-react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { FarmInquiryButtons } from '../components/shared/KakaoChannelButton'
import { Button } from '../components/ui/Button'
import { PageSpinner } from '../components/ui/Feedback'
import { copyText } from '../lib/clipboard'
import { farmLandingPath, farmQrPath } from '../lib/farmShareText'
import { normalizeAccountNumber } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Farm } from '../types/models'

type FarmQrInfo = Pick<
  Farm,
  | 'slug'
  | 'bank_name'
  | 'account_number'
  | 'account_holder'
  | 'kakao_channel_url'
  | 'phone'
  | 'mobile_phone'
>

/** 예전 /a?farm=... 링크를 /farm/:slug/qr 로 넘긴다. */
export function LegacyAccountCopyRedirect() {
  const [params] = useSearchParams()
  const farm = (params.get('farm') ?? '').trim()
  if (farm) return <Navigate to={farmQrPath(farm)} replace />
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-6">
      <p className="text-sm text-muted">유효한 계좌 정보가 없습니다.</p>
    </div>
  )
}

export function AccountCopyPage() {
  const { farmSlug = '' } = useParams()
  const [copied, setCopied] = useState(false)
  const [hint, setHint] = useState('계좌번호를 복사하는 중…')
  const [farm, setFarm] = useState<FarmQrInfo | null>(null)
  const [loading, setLoading] = useState(true)

  const accountWrapRef = useRef<HTMLDivElement>(null)
  const accountMeasureRef = useRef<HTMLSpanElement>(null)
  const accountTextRef = useRef<HTMLParagraphElement>(null)
  const bank = farm?.bank_name?.trim() ?? ''
  const account = farm?.account_number?.trim() ?? ''
  const accountForCopy = normalizeAccountNumber(account)
  const holder = farm?.account_holder?.trim() ?? ''

  useLayoutEffect(() => {
    const wrap = accountWrapRef.current
    const measure = accountMeasureRef.current
    const text = accountTextRef.current
    if (!wrap || !measure || !text || !account) return

    const fit = () => {
      text.style.fontSize = ''
      measure.style.fontSize = ''
      const maxPx = parseFloat(getComputedStyle(text).fontSize)
      const minPx = 12
      const available = wrap.clientWidth
      if (available <= 0) return

      let lo = minPx
      let hi = maxPx
      let best = minPx
      while (hi - lo > 0.25) {
        const mid = (lo + hi) / 2
        measure.style.fontSize = `${mid}px`
        if (measure.scrollWidth <= available) {
          best = mid
          lo = mid
        } else {
          hi = mid
        }
      }
      text.style.fontSize = `${best}px`
      measure.style.fontSize = `${best}px`
    }

    fit()
    void document.fonts?.ready.then(fit)
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(fit)
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [account])

  async function copy(source: 'auto' | 'tap') {
    if (!accountForCopy) return
    const ok = await copyText(accountForCopy)
    if (ok) {
      setCopied(true)
      setHint('계좌번호가 복사되었습니다')
      window.setTimeout(() => setCopied(false), 2500)
      return
    }
    setHint(
      source === 'auto'
        ? '아래 버튼을 눌러 계좌번호를 복사하세요'
        : '복사에 실패했습니다. 계좌번호를 길게 눌러 복사하세요',
    )
  }

  useEffect(() => {
    if (!farmSlug) {
      setFarm(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('farms')
          .select('slug, bank_name, account_number, account_holder, kakao_channel_url, phone, mobile_phone')
          .eq('slug', farmSlug)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          setFarm(null)
          return
        }
        setFarm((data as FarmQrInfo | null) ?? null)
      } catch {
        if (!cancelled) setFarm(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [farmSlug])

  useEffect(() => {
    if (loading || !accountForCopy) return
    void copyText(accountForCopy).then((ok) => {
      if (ok) {
        setCopied(true)
        setHint('계좌번호가 복사되었습니다')
        window.setTimeout(() => setCopied(false), 2500)
      } else {
        setHint('아래 버튼을 눌러 계좌번호를 복사하세요')
      }
    })
  }, [loading, accountForCopy])

  if (loading) return <PageSpinner />

  if (!farm || !accountForCopy) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface px-6">
        <p className="text-sm text-muted">유효한 계좌 정보가 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-surface px-6 pt-10 pb-10">
      <div className="mx-auto w-full max-w-md space-y-8">
        <section className="space-y-4 rounded-2xl border border-primary/20 bg-white p-5 text-center shadow-sm">
          <div className="space-y-2">
            {bank ? <p className="text-xl font-semibold text-gray-900">{bank}</p> : null}
            <div ref={accountWrapRef} className="relative min-w-0 w-full overflow-hidden">
              <span
                ref={accountMeasureRef}
                className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap text-3xl font-bold tracking-wide"
                aria-hidden
              >
                {account}
              </span>
              <p
                ref={accountTextRef}
                className="w-full overflow-hidden whitespace-nowrap text-3xl font-bold tracking-wide text-gray-900 select-all"
              >
                {account}
              </p>
            </div>
            {holder ? <p className="text-lg text-muted">예금주 {holder}</p> : null}
          </div>
          <p className={`text-sm ${copied ? 'font-medium text-primary' : 'text-muted'}`}>{hint}</p>
          <Button
            type="button"
            fullWidth
            size="lg"
            className="!bg-[#9333EA] !text-white hover:!bg-[#7E22CE] active:scale-[0.98]"
            onClick={() => void copy('tap')}
          >
            {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
            {copied ? '복사됨' : '계좌번호 복사'}
          </Button>
          <p className="text-xs text-muted">복사 후 은행 앱에서 붙여넣어 입금하세요.</p>
        </section>

        <section className="space-y-3 border-t border-gray-200 pt-6">
          <FarmInquiryButtons
            kakaoChannelUrl={farm.kakao_channel_url}
            phone={farm.phone}
            mobilePhone={farm.mobile_phone}
            kakaoLabel="카카오톡 채널추가"
            kakaoLink="profile"
          />
          <Link to={farmLandingPath(farm.slug)} className="block">
            <Button size="lg" fullWidth>
              <Package className="h-5 w-5" />
              간편 택배 주문
            </Button>
          </Link>
        </section>
      </div>
    </div>
  )
}
