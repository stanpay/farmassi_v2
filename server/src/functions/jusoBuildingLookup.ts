/**
 * 행정안전부 도로명주소 API(business.juso.go.kr)로 건물의 동·호 정보를 조회한다.
 * - 검색 API: 공동주택 여부(bdKdcd)와 상세주소 API 를 부를 건물 키
 * - 상세주소 API: 건물의 동 목록, 동별 호 목록
 *
 * Vite 개발 프록시도 이 파일을 그대로 쓰므로 다른 서버 모듈을 import 하지 않는다.
 */

const SEARCH_ENDPOINT = 'https://business.juso.go.kr/addrlink/addrLinkApi.do'
const DETAIL_ENDPOINT = 'https://business.juso.go.kr/addrlink/addrDetailApi.do'

/** 동 목록에 섞여 오는 주거용이 아닌 동 */
const NON_RESIDENTIAL_DONG =
  /상가|관리|경비|노인|경로|주차|어린이|보육|유치원|커뮤니티|부대|근린|복리|기계|전기|변전|펌프|창고|사무|문고|독서|헬스|피트니스|휘트니스|공용|종교|교회/

type JusoRow = Record<string, string | undefined>

export type JusoKeys = { searchKey: string; detailKey: string }

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

const compact = (value: string) => value.replace(/\s+/g, '')

/** '서울특별시 강서구 강서로 532 (가양동, …) 101동~110동' → '서울특별시 강서구 강서로 532' */
export const jusoRoadBase = (address: string) => address.trim().split(/\s*\(/)[0].trim()

const dongKey = (value: string) => compact(value).replace(/동$/, '').toUpperCase()

async function getJuso(endpoint: string, params: Record<string, string>): Promise<JusoRow[]> {
  const url = new URL(endpoint)
  for (const [key, value] of Object.entries({ ...params, resultType: 'json' })) {
    url.searchParams.set(key, value)
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`도로명주소 조회 HTTP ${response.status}`)
  const payload = (await response.json()) as {
    results?: { common?: { errorCode?: string; errorMessage?: string }; juso?: JusoRow[] | null }
  }
  const common = payload.results?.common
  if (common?.errorCode && common.errorCode !== '0') {
    throw new Error(common.errorMessage || '도로명주소 조회에 실패했습니다.')
  }
  return payload.results?.juso ?? []
}

function pickBuilding(rows: JusoRow[], road: string): JusoRow | null {
  const target = compact(road)
  const exact = rows.filter((row) => compact(row.roadAddrPart1 ?? '') === target)
  if (exact.length === 1) return exact[0]
  return rows.length === 1 ? rows[0] : null
}

export async function lookupJusoBuilding(
  road: string,
  dong: string,
  keys: JusoKeys,
): Promise<JusoBuildingInfo> {
  if (!keys.searchKey) throw new Error('도로명주소 API 키(JUSO_SEARCH_API_KEY)가 설정되지 않았습니다.')
  if (!keys.detailKey) throw new Error('도로명주소 API 키(JUSO_DETAIL_API_KEY)가 설정되지 않았습니다.')

  const rows = await getJuso(SEARCH_ENDPOINT, {
    confmKey: keys.searchKey,
    keyword: road,
    currentPage: '1',
    countPerPage: '20',
  })
  const building = pickBuilding(rows, road)
  if (!building) {
    return { found: false, apartment: false, buildingName: '', dongs: [], hos: null, hoDong: null }
  }

  const buildingKey = {
    admCd: building.admCd ?? '',
    rnMgtSn: building.rnMgtSn ?? '',
    udrtYn: building.udrtYn ?? '',
    buldMnnm: building.buldMnnm ?? '',
    buldSlno: building.buldSlno ?? '',
  }
  const fetchHos = async (dongNm: string) => {
    const hoRows = await getJuso(DETAIL_ENDPOINT, {
      confmKey: keys.detailKey,
      ...buildingKey,
      searchType: 'floorho',
      dongNm,
    })
    return [...new Set(hoRows.map((row) => (row.hoNm ?? '').trim()).filter(Boolean))]
  }
  // 동 목록을 기다리지 않고 '103동' 형태(동이 없으면 '')로 호 목록을 함께 받아 둔다.
  const guessedDong = dong ? `${dongKey(dong)}동` : ''
  const [dongRows, guessedHos] = await Promise.all([
    getJuso(DETAIL_ENDPOINT, { confmKey: keys.detailKey, ...buildingKey, searchType: 'dong' }),
    fetchHos(guessedDong),
  ])
  const unitDongs = [
    ...new Set(
      dongRows
        .map((row) => (row.dongNm ?? '').trim())
        .filter((name) => !NON_RESIDENTIAL_DONG.test(name)),
    ),
  ]

  let target: string | null =
    unitDongs.find((name) => dong && name && dongKey(name) === dongKey(dong)) ?? null
  const unnamedOnly = unitDongs.length === 1 && unitDongs[0] === ''
  if (target === null && (unnamedOnly || (!dong && unitDongs.length === 1))) {
    target = unitDongs[0]
  }

  let hos: string[] | null = null
  if (target !== null) {
    hos = target === guessedDong ? guessedHos : await fetchHos(target)
  }

  return {
    found: true,
    apartment: building.bdKdcd === '1',
    buildingName: building.bdNm ?? '',
    dongs: unitDongs.filter(Boolean),
    hos,
    hoDong: target,
  }
}
