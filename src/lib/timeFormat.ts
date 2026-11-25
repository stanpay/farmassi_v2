// 초 단위 시각과 단계 간격 (카카오톡 로그·배송 웹훅 기록).

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

/** 2026. 11. 26. 00:18:57 (한국 시간) */
export function formatSeconds(value: string) {
  return SECONDS.format(new Date(value))
}

/** 앞 단계와의 간격: +2초, +3분 5초, +1시간 2분, +2일 3시간 */
export function formatGap(fromIso: string, toIso: string) {
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
