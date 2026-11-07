import { isDevAuthBypass } from './devAuthBypass'
import { invokeFunction } from './functions'

export type EpostAddressResult = {
  id: string
  zipNo: string
  roadAddress: string
  jibunAddress: string
}

/**
 * 카톡 주소 문구를 기본주소(도로명·번지)와 상세(동·호·아파트명)로 나눈다.
 * 예: "서울 강서구 강서로 532, 103동 801호(가양동 동신아파트)"
 *   → base "서울 강서구 강서로 532" / detail "103동 801호(가양동 동신아파트)"
 */
export function splitAddressParts(input: string): { address: string; addressDetail: string } {
  const full = input.replace(/\s+/g, ' ').trim()
  if (!full) return { address: '', addressDetail: '' }

  // "도로명 번지, 상세" — 쉼표 뒤가 동·호·건물인 경우
  const commaSplit = full.match(
    /^(.+?(?:대로|로|길|리|가)\s*\d+(?:-\d+)?)(?:\s*,\s*|\s*,)(.+)$/i,
  )
  if (commaSplit) {
    const address = commaSplit[1].trim()
    const addressDetail = commaSplit[2].trim()
    if (address && addressDetail) return { address, addressDetail }
  }

  // 번지 뒤 공백 + 동·호 / 아파트명+동호
  const spaced = full.match(
    /^(.+?(?:대로|로|길|리|가)\s*\d+(?:-\d+)?)(?:\s+)(.+)$/i,
  )
  if (spaced) {
    const address = spaced[1].trim()
    const addressDetail = spaced[2].trim()
    if (
      address &&
      addressDetail &&
      /\d+\s*동|\d+\s*호|아파트|APT|빌라|빌딩|타워|오피스텔|\([^)]+\)/i.test(addressDetail)
    ) {
      return { address, addressDetail }
    }
  }

  // 이미 상세만 남은 패턴 (도로명 매칭 실패 시)
  const trailing = full.match(
    /^(.*?\d(?:-\d+)?)\s+((?:[가-힣A-Za-z0-9]+\s*)*(?:아파트|APT|Apt|빌라|빌딩|타워)?\s*\d+\s*동\s*\d+\s*호.*)$/i,
  )
  if (trailing) {
    return { address: trailing[1].trim(), addressDetail: trailing[2].trim() }
  }

  return { address: full, addressDetail: '' }
}

/** 파서가 나눠 준 값을 기준으로, 기본에 상세가 붙어 있으면 다시 분리한다. */
export function normalizeAddressParts(
  address: string,
  addressDetail: string,
): { address: string; addressDetail: string } {
  const base = address.replace(/\s+/g, ' ').trim()
  const detail = addressDetail.replace(/\s+/g, ' ').trim()

  if (!base) return { address: '', addressDetail: detail }

  // 기본주소에 동·호·쉼표 상세가 남아 있으면 분리
  const looksCombined =
    /,\s*\d+\s*동|,.*호|\d+\s*동\s*\d+\s*호|(?:아파트|APT|빌라).*\d+\s*동/i.test(base)
  if (looksCombined) {
    const split = splitAddressParts(base)
    if (split.addressDetail) {
      const mergedDetail = [split.addressDetail, detail].filter(Boolean).join(' ').trim()
      return { address: split.address, addressDetail: mergedDetail }
    }
  }

  if (detail) return { address: base, addressDetail: detail }

  return splitAddressParts(base)
}

/** 동·호·아파트명 등을 떼고 도로명+건물번호 쪽만 남긴다. 우체국 검색어용. */
export function buildEpostSearchQuery(address: string): string {
  let text = address.trim().replace(/\s+/g, ' ')
  // 도로명+건물번호가 있으면 그 뒤(쉼표·건물명·동·호)는 모두 상세라 자른다.
  const roadCut = text.match(
    /^(.*?[가-힣A-Za-z0-9]+(?:대로|로|길)(?:\s*\d+(?:번)?(?:길|로))?\s*\d+(?:-\d+)?)(?!\d)/,
  )
  if (roadCut) text = roadCut[1]
  // 101동1203호 / 101동 1203호 / 1502동 804호
  text = text.replace(/\s*\d+\s*동\s*\d+\s*호(?=\s|$)/g, ' ')
  text = text.replace(/\s*\d+\s*동(?=\s|$)/g, ' ')
  text = text.replace(/\s*\d+\s*호(?=\s|$)/g, ' ')
  // 로12 / 길8 / 대로152
  text = text.replace(/(대로|로|길|리|가)(\d)/g, '$1 $2')
  // 건물번호 뒤에 붙은 건물명: 8하늘아파트 (길·로·동·호는 도로명 일부라 제외)
  text = text.replace(/(\d)(?!동|호|길|로)([가-힣A-Za-z])/g, '$1 $2')
  // 아파트·건물 표기(+앞쪽 한글/영문 이름)부터는 상세로 제외 — "예림 아너스아파트"
  // 도로명·번지(숫자 포함 토큰)는 건드리지 않도록 숫자 없는 이름만 매칭한다.
  text = text.replace(
    /\s+(?:[가-힣A-Za-z]+\s+)*[가-힣A-Za-z]*?(아파트|APT|Apt|빌라|빌딩|타워|오피스텔|주상복합).*$/i,
    ' ',
  )
  return text.replace(/\s+/g, ' ').trim()
}

/** 원문에서 도로명 뒤에 남는 상세(동·호·건물명)를 추정한다. */
export function extractAddressDetail(address: string, roadAddress: string): string {
  const normalized = address.replace(/\s+/g, ' ').trim()
  const road = roadAddress.replace(/\s+/g, ' ').trim()
  if (!normalized || !road) return ''

  const compact = (value: string) =>
    value
      .replace(/특별시|광역시|특별자치시|특별자치도/g, '')
      .replace(/\s+/g, '')
      .toLowerCase()

  const needle = compact(road)
  const hay = compact(normalized)
  const idx = hay.indexOf(needle)
  if (idx < 0) {
    // 도로명을 못 찾으면 동·호 패턴만 건진다
    const detailMatch = normalized.match(/([가-힣A-Za-z0-9]+(?:아파트|APT)?\s*\d+\s*동\s*\d+\s*호.*)$/i)
    return detailMatch?.[1]?.trim() ?? ''
  }

  // compact 인덱스로는 원문 slice가 어렵으니 동·호 구간을 우선 추출
  const detailMatch = normalized.match(
    /((?:[가-힣A-Za-z0-9]+(?:아파트|APT|Apt)?)\s*)?\d+\s*동\s*\d+\s*호.*$/i,
  )
  if (detailMatch) return detailMatch[0].trim()

  return ''
}

async function searchEpostAddressesDev(
  query: string,
  options?: { countPerPage?: number; currentPage?: number },
): Promise<EpostAddressResult[]> {
  const response = await fetch('/__dev/epost-address', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      countPerPage: options?.countPerPage ?? 20,
      currentPage: options?.currentPage ?? 1,
    }),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    results?: EpostAddressResult[]
    error?: string
  }
  if (!response.ok) {
    throw new Error(payload.error || `우체국 주소 조회 실패 (${response.status})`)
  }
  return payload.results ?? []
}

export async function searchEpostAddresses(
  query: string,
  options?: { countPerPage?: number; currentPage?: number },
): Promise<EpostAddressResult[]> {
  // 원격 API 가 죽어 있는 로컬 bypass 환경에서는 Vite 프록시를 탄다.
  if (isDevAuthBypass()) {
    return searchEpostAddressesDev(query, options)
  }
  const data = await invokeFunction<{ results?: EpostAddressResult[] }>('epost-address', {
    query,
    countPerPage: options?.countPerPage ?? 20,
    currentPage: options?.currentPage ?? 1,
  })
  return data.results ?? []
}

const SIDO_ALIASES: Array<[RegExp, string]> = [
  [/^(서울|부산|대구|인천|광주|대전|울산)(?:특별시|광역시|시)?/, '$1'],
  [/^세종(?:특별자치시|시)?/, '세종'],
  [/^경기도?/, '경기'],
  [/^강원(?:특별자치도|도)?/, '강원'],
  [/^(?:충청북도|충북)/, '충북'],
  [/^(?:충청남도|충남)/, '충남'],
  [/^(?:전라북도|전북특별자치도|전북)/, '전북'],
  [/^(?:전라남도|전남)/, '전남'],
  [/^(?:경상북도|경북)/, '경북'],
  [/^(?:경상남도|경남)/, '경남'],
  [/^제주(?:특별자치도|도)?/, '제주'],
]

/** "서울시"·"서울특별시"·"서울" 처럼 표기만 다른 시·도를 같은 키로 맞춘다. */
function normalizeSido(value: string) {
  const text = value.trim()
  for (const [pattern, replacement] of SIDO_ALIASES) {
    if (pattern.test(text)) return text.replace(pattern, replacement)
  }
  return text
}

function compactAddress(value: string) {
  return normalizeSido(value)
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** 주소 첫 단어가 시·도면 정규화한 이름(서울·인천·경기…)을, 아니면 빈 문자열을 준다. */
function leadingSido(address: string): string {
  const first = address.trim().split(/\s+/)[0] ?? ''
  return SIDO_ALIASES.some(([pattern]) => pattern.test(first)) ? normalizeSido(first) : ''
}

/** "노원로 22길 71" → "노원로22길 71", "용해로20" → "용해로 20" */
function roadWithNumber(address: string): string {
  const match = buildEpostSearchQuery(address).match(
    /([가-힣A-Za-z0-9]+(?:대로|로|길)(?:\s*\d+(?:번)?(?:길|로))?)\s+(\d+(?:-\d+)?)/,
  )
  return match ? `${match[1].replace(/\s+/g, '')} ${match[2]}` : ''
}

/**
 * 시·군·구가 바뀌었거나(예: 인천 서구 → 검단구) 틀려서 검색이 안 될 때 쓰는 대체 검색어.
 * 예: "인천 서구 용해로20 …" → ["인천 용해로 20", "용해로 20"]
 */
export function buildEpostFallbackQueries(address: string): string[] {
  const road = roadWithNumber(address)
  if (!road) return []
  const sido = leadingSido(address)
  return [...new Set([sido ? `${sido} ${road}` : '', road].filter(Boolean))]
}

/** 시·도 + 도로명 + 건물번호가 같은지 본다(구 이름은 보지 않음). */
function sameRoadKey(address: string, result: EpostAddressResult): boolean {
  const road = roadWithNumber(address)
  if (!road || road !== roadWithNumber(result.roadAddress)) return false
  const sido = leadingSido(address)
  return !sido || sido === leadingSido(result.roadAddress)
}

/** 시·도 다음의 시·군·구 이름. 예: "인천 서구 용해로20" → "서구" */
function districtOf(address: string): string {
  const tokens = address.trim().split(/\s+/)
  const start = leadingSido(address) ? 1 : 0
  return tokens.slice(start).find((token) => /^[가-힣]+(?:시|군|구)$/.test(token)) ?? ''
}

/**
 * 도로명·건물번호는 같은데 시·군·구가 원문과 다른 후보면 두 이름을 돌려준다.
 * 행정구역 변경(예: 인천 서구 → 검단구)일 수 있어 자동 확정하지 않고 확인받는다.
 */
export function findDistrictMismatch(
  address: string,
  result: EpostAddressResult,
): { original: string; epost: string } | null {
  if (matchesEpostResult(address, result) || !sameRoadKey(address, result)) return null
  const original = districtOf(address)
  const epost = districtOf(result.roadAddress)
  return original && epost && original !== epost ? { original, epost } : null
}

/** 원문이 우체국 후보(도로명 또는 지번)와 일치하는지 본다. */
export function matchesEpostResult(address: string, result: EpostAddressResult): boolean {
  if (!address.trim()) return false
  const target = compactAddress(address)
  if (!target) return false

  const road = compactAddress(result.roadAddress)
  if (road.length >= 6 && (target.includes(road) || road.includes(target))) return true

  const jibun = compactAddress(result.jibunAddress)
  if (jibun.length >= 6 && (target.includes(jibun) || jibun.includes(target))) return true

  return false
}

/** 우체국 검색 결과로 주소가 확정됐는지 본다. 도로명·지번 모두 본다. */
export function isEpostAddressResolved(address: string, results: EpostAddressResult[]): boolean {
  if (!address.trim() || results.length === 0) return false
  return results.some((row) => matchesEpostResult(address, row))
}

/**
 * 자동 확정용: 결과가 정확히 1건이고 원문과 일치할 때만 반환.
 * 같은 건물이 단지명만 달리 여러 줄로 와도 여러 건이므로 사용자가 고른다.
 */
export function resolveUniqueEpostMatch(
  address: string,
  results: EpostAddressResult[],
): EpostAddressResult | null {
  if (results.length !== 1) return null
  return matchesEpostResult(address, results[0]) ? results[0] : null
}
