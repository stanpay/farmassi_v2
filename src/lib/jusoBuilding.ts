import { isDevAuthBypass } from './devAuthBypass'
import { invokeFunction } from './functions'

/** 도로명주소 API 로 조회한 건물의 동·호 정보 (서버 `juso-building` 응답) */
export type JusoBuildingInfo = {
  found: boolean
  /** 공동주택(아파트·연립·다세대) */
  apartment: boolean
  buildingName: string
  /** 주거용 동 이름. 동 이름이 없는 단일 건물이면 빈 배열 */
  dongs: string[]
  /** hoDong 의 호 목록. 동을 특정하지 못하면 null */
  hos: string[] | null
  /** hos 를 조회한 동. '' 은 동 이름이 없는 건물 */
  hoDong: string | null
}

export type AddressDetailCheck = {
  /** 동·호 문제 안내. 문제가 없으면 null */
  problem: string | null
  /** 건물 정보. 조회에 실패했으면 null */
  info: JusoBuildingInfo | null
}

// 3~4자리는 단지 동 번호. 1~2자리는 '가양1동' 같은 행정동과 헷갈리지 않게 앞이 한글이 아닐 때만.
const DONG_PATTERNS = [
  /(?<!\d)(\d{3,4})\s*동(?![가-힣])/,
  /(?<![가-힣\d])(\d{1,2}|[A-Za-z]|[가나다라마바사아자차카타파하])\s*동(?![가-힣])/,
]
const HO_PATTERN = /(?<!\d)([A-Za-z]?\d{1,5})\s*호(?!선)/
/** '103-801' 처럼 동·호를 하이픈으로 붙여 쓴 경우 */
const DASH_PATTERN = /(?<![\d-])(\d{1,4})\s*-\s*(\d{1,5})(?![\d-])/

const MULTI_UNIT_HINT = /아파트|APT|빌라|맨션|오피스텔|연립|다세대|타운|하이츠|캐슬|빌리지/i

/** 상세주소에서 동·호를 뽑는다. 예: '103동 801호(가양동 동신아파트)' → { dong: '103', ho: '801' } */
export function parseDongHo(detail: string): { dong: string; ho: string } {
  const text = detail.replace(/\s+/g, ' ').trim()
  const dong = DONG_PATTERNS.map((re) => text.match(re)?.[1]).find(Boolean) ?? ''
  const ho = text.match(HO_PATTERN)?.[1] ?? ''
  if (!dong && !ho) {
    const dash = text.match(DASH_PATTERN)
    if (dash) return { dong: dash[1], ho: dash[2] }
  }
  return { dong: dong.toUpperCase(), ho: ho.toUpperCase() }
}

const unitKey = (value: string, suffix: '동' | '호') =>
  value.replace(/\s+/g, '').replace(new RegExp(`${suffix}$`), '').toUpperCase()

export function summarizeDongs(dongs: string[]): string {
  const sorted = [...dongs].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))
  if (sorted.length <= 4) return sorted.join(', ')
  return `${sorted[0]}~${sorted[sorted.length - 1]} 등 ${sorted.length}개 동`
}

/** 건물 정보와 상세주소의 동·호를 비교해 문제를 찾는다. */
export function judgeAddressDetail(info: JusoBuildingInfo, dong: string, ho: string): string | null {
  const problems: string[] = []
  const hasDong = info.dongs.some((name) => unitKey(name, '동') === unitKey(dong, '동'))

  if (!dong && info.dongs.length >= 2) {
    problems.push(`동이 빠졌습니다 (${summarizeDongs(info.dongs)})`)
  } else if (dong && info.dongs.length > 0 && !hasDong) {
    problems.push(`${dong}동은 이 건물에 없습니다 (${summarizeDongs(info.dongs)})`)
  }

  const needsHo = info.apartment || info.dongs.length > 0 || (info.hos?.length ?? 0) > 0
  if (!ho && needsHo) {
    problems.push('호수가 빠졌습니다')
  } else if (ho && info.hos && info.hos.length > 0) {
    const hasHo = info.hos.some((name) => unitKey(name, '호') === unitKey(ho, '호'))
    if (!hasHo) {
      const where = info.hoDong ? `${info.hoDong} ` : ''
      const sorted = [...info.hos].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))
      const range = sorted.length > 1 ? `${sorted[0]}~${sorted[sorted.length - 1]}` : sorted[0]
      problems.push(
        `${where}${ho}호는 등록된 호수에 없습니다. ${info.hoDong ? `${info.hoDong}은` : '이 건물은'} ${range}입니다`,
      )
    }
  }

  return problems.length > 0 ? `${problems.join(' · ')}. 확인해 주세요.` : null
}

/** 건물 조회가 안 될 때: 주소에 공동주택 표기나 동이 있는데 호가 없으면 의심한다. */
function guessAddressDetail(roadAddress: string, detail: string, dong: string, ho: string): string | null {
  if (ho) return null
  if (dong || MULTI_UNIT_HINT.test(`${roadAddress} ${detail}`)) {
    return '공동주택으로 보이는데 호수가 없습니다. 확인해 주세요.'
  }
  return null
}

async function fetchJusoBuildingDev(address: string, dong: string): Promise<JusoBuildingInfo> {
  const response = await fetch('/__dev/juso-building', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, dong }),
  })
  const payload = (await response.json().catch(() => ({}))) as JusoBuildingInfo & { error?: string }
  if (!response.ok) {
    throw new Error(payload.error || `도로명주소 조회 실패 (${response.status})`)
  }
  return payload
}

/** 같은 건물·동은 다시 묻지 않는다. 진행 중인 요청도 함께 쓴다. */
const buildingCache = new Map<string, Promise<JusoBuildingInfo>>()

function buildingCacheKey(address: string, dong: string): string {
  const road = address.split(/\s*\(/)[0].replace(/\s+/g, '')
  return `${road}|${unitKey(dong, '동')}`
}

export function fetchJusoBuilding(address: string, dong = ''): Promise<JusoBuildingInfo> {
  const key = buildingCacheKey(address, dong)
  const cached = buildingCache.get(key)
  if (cached) return cached
  const request = isDevAuthBypass()
    ? fetchJusoBuildingDev(address, dong)
    : invokeFunction<JusoBuildingInfo>('juso-building', { address, dong })
  buildingCache.set(key, request)
  request.catch(() => buildingCache.delete(key))
  return request
}

/** 이 상세주소의 동으로 이미 조회했거나 조회 중인지. 그렇다면 기다릴 필요 없이 바로 판단한다. */
export function isAddressDetailCached(roadAddress: string, detail: string): boolean {
  return buildingCache.has(buildingCacheKey(roadAddress, parseDongHo(detail).dong))
}

/**
 * 확정된 도로명주소와 상세주소로 동·호가 빠지거나 틀렸는지 본다.
 * - 공동주택이거나 등록된 호가 있으면 호 필수
 * - 주거용 동이 2개 이상이면 동 필수
 * 건물 조회에 실패하면 주소 표기로 추정한다.
 */
export async function checkAddressDetail(roadAddress: string, detail: string): Promise<AddressDetailCheck> {
  const { dong, ho } = parseDongHo(detail)
  try {
    const info = await fetchJusoBuilding(roadAddress, dong)
    if (info.found) return { problem: judgeAddressDetail(info, dong, ho), info }
  } catch {
    // 조회 실패는 아래 추정으로 대신한다.
  }
  return { problem: guessAddressDetail(roadAddress, detail, dong, ho), info: null }
}
