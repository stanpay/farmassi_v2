import { Phone } from 'lucide-react'
import { kakaoChannelChatHref, kakaoChannelHref, safeHttpUrl } from '../../lib/format'
import { telHref } from '../../lib/farmShareText'

interface KakaoChannelButtonProps {
  href: string
  label?: string
}

const inquiryBtnClass =
  'flex h-[45px] w-full min-w-0 items-center justify-center gap-1.5 rounded-[12px] px-2 text-[15px] font-medium sm:flex-1'

/** href는 호출측에서 이미 확정한 URL(프로필 또는 /chat)을 그대로 연다. */
export function KakaoChannelButton({ href, label = '카카오톡 문의' }: KakaoChannelButtonProps) {
  const link = safeHttpUrl(href)
  if (!link) return null
  return (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className={`${inquiryBtnClass} bg-[#FEE500] text-black/85 hover:bg-[#F5DC00]`}
    >
      <span className="flex size-[18px] shrink-0 items-center justify-center">
        <KakaoSymbol />
      </span>
      <span className="truncate">{label}</span>
    </a>
  )
}

export function PhoneInquiryButton({ phone, label = '전화문의' }: { phone: string; label?: string }) {
  const href = telHref(phone)
  if (!href) return null
  return (
    <a
      href={href}
      className={`${inquiryBtnClass} border-2 border-primary bg-primary-light text-primary hover:bg-white`}
    >
      <Phone className="size-[18px] shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  )
}

export function FarmInquiryButtons({
  kakaoChannelUrl,
  phone,
  mobilePhone,
  kakaoLabel,
  /** 기본 chat(문의). 계좌 QR 등 채널추가는 profile */
  kakaoLink = 'chat',
}: {
  kakaoChannelUrl?: string | null
  phone?: string | null
  mobilePhone?: string | null
  kakaoLabel?: string
  kakaoLink?: 'chat' | 'profile'
}) {
  const kakaoHref =
    kakaoLink === 'profile' ? kakaoChannelHref(kakaoChannelUrl) : kakaoChannelChatHref(kakaoChannelUrl)
  const callPhone = mobilePhone?.trim() || phone?.trim() || null
  if (!kakaoHref && !callPhone) return null
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {kakaoHref ? <KakaoChannelButton href={kakaoHref} label={kakaoLabel} /> : null}
      {callPhone ? <PhoneInquiryButton phone={callPhone} /> : null}
    </div>
  )
}

export function KakaoSymbol({ size = 18, fill = '#000' }: { size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden className="inline-block shrink-0 translate-y-[1px]">
      <path
        fill={fill}
        fillRule="evenodd"
        d="M9 1.2C4.306 1.2.5 4.29.5 8.1c0 2.4 1.56 4.51 3.93 5.73L3.4 17.4c-.05.2.16.36.34.26l4.18-2.77c.35.05.71.07 1.08.07 4.694 0 8.5-3.09 8.5-6.9S13.694 1.2 9 1.2Z"
      />
    </svg>
  )
}
