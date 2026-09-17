import { isDevAuthBypass } from './devAuthBypass'
import { invokeFunction } from './functions'

export type EpostAddressResult = {
  id: string
  zipNo: string
  roadAddress: string
  jibunAddress: string
}

/** 동·호·아파트명 등을 떼고 도로명+건물번호 쪽만 남긴다. 우체국 검색어용. */
export function buildEpostSearchQuery(address: string): string {
  let text = address.trim().replace(/\s+/g, ' ')
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

function compactAddress(value: string) {
  return value
    .replace(/특별시|광역시|특별자치시|특별자치도/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** 우체국 검색 결과로 주소가 확정됐는지 본다. */
export function isEpostAddressResolved(address: string, results: EpostAddressResult[]): boolean {
  if (!address.trim() || results.length === 0) return false
  const target = compactAddress(address)
  return results.some((row) => {
    const road = compactAddress(row.roadAddress)
    if (road.length < 6) return false
    return target.includes(road)
  })
}
