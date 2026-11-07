import { fail, ok, type FnHandler } from './types.ts'

const ENDPOINT =
  'http://openapi.epost.go.kr/postal/retrieveNewAdressAreaCdSearchAllService/retrieveNewAdressAreaCdSearchAllService/getNewAddressListAreaCdSearchAll'

const ITEM_RE = /<newAddressListAreaCdSearchAll>([\s\S]*?)<\/newAddressListAreaCdSearchAll>/g
const HEADER_RE = /<cmmMsgHeader>([\s\S]*?)<\/cmmMsgHeader>/
const FIELD_RE = {
  successYN: /<successYN>([\s\S]*?)<\/successYN>/,
  errMsg: /<errMsg>([\s\S]*?)<\/errMsg>/,
  returnCode: /<returnCode>([\s\S]*?)<\/returnCode>/,
  zipNo: /<zipNo>([\s\S]*?)<\/zipNo>/,
  lnmAdres: /<lnmAdres>([\s\S]*?)<\/lnmAdres>/,
  rnAdres: /<rnAdres>([\s\S]*?)<\/rnAdres>/,
}

function serviceKey() {
  const raw = (process.env.EPOST_SERVICE_KEY ?? '').trim()
  if (!raw) throw new Error('우체국 Open API 키(EPOST_SERVICE_KEY)가 설정되지 않았습니다.')
  return raw.includes('%') ? decodeURIComponent(raw) : raw
}

function unwrap(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function field(chunk: string, re: RegExp) {
  const match = re.exec(chunk)
  return match ? unwrap(match[1]) : ''
}

function parseResults(xmlText: string) {
  const header = HEADER_RE.exec(xmlText)?.[1]
  if (header) {
    const success = field(header, FIELD_RE.successYN)
    if (success === 'N') {
      const err = field(header, FIELD_RE.errMsg)
      const code = field(header, FIELD_RE.returnCode)
      throw new Error(err || `우체국 주소 조회 실패 (코드 ${code || '?'})`)
    }
  }

  const results = []
  for (const match of xmlText.matchAll(ITEM_RE)) {
    const chunk = match[1]
    const zipNo = field(chunk, FIELD_RE.zipNo)
    const roadAddress = field(chunk, FIELD_RE.lnmAdres)
    const jibunAddress = field(chunk, FIELD_RE.rnAdres)
    if (!zipNo && !roadAddress && !jibunAddress) continue
    results.push({
      id: `epost:${zipNo}:${roadAddress}:${jibunAddress}`,
      zipNo,
      roadAddress,
      jibunAddress,
    })
  }
  return results
}

async function search(query: string, countPerPage: number, currentPage: number) {
  const url = new URL(ENDPOINT)
  url.searchParams.set('serviceKey', serviceKey())
  url.searchParams.set('srchwrd', query)
  url.searchParams.set('countPerPage', String(Math.max(1, Math.min(countPerPage, 50))))
  url.searchParams.set('currentPage', String(Math.max(1, currentPage)))

  const response = await fetch(url)
  if (!response.ok) throw new Error(`우체국 주소 조회 HTTP ${response.status}`)
  return parseResults(await response.text())
}

export const epostAddress: FnHandler = async (ctx) => {
  if (!ctx.userId) return fail('로그인이 필요합니다.', 401)
  try {
    const query = String(ctx.body?.query ?? '').trim()
    if (query.length < 2) return fail('검색어를 입력해 주세요.')
    const countPerPage = Number(ctx.body?.countPerPage ?? 20)
    const currentPage = Number(ctx.body?.currentPage ?? 1)
    if (!Number.isFinite(countPerPage) || !Number.isFinite(currentPage)) {
      return fail('요청이 올바르지 않습니다.')
    }
    return ok({
      results: await search(query, countPerPage, currentPage),
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : '우체국 주소 조회에 실패했습니다.', 500)
  }
}
