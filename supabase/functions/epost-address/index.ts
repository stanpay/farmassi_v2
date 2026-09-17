import { corsHeaders, getUserFromRequest, json } from '../_shared/http.ts'

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
  const raw = (Deno.env.get('EPOST_SERVICE_KEY') ?? '').trim()
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const user = await getUserFromRequest(req)
  if (!user) return json({ error: '로그인이 필요합니다.' }, 401)

  try {
    const body = (await req.json()) as {
      query?: string
      countPerPage?: number
      currentPage?: number
    }
    const query = body.query?.trim() ?? ''
    if (query.length < 2) return json({ error: '검색어를 입력해 주세요.' }, 400)
    const countPerPage = Number(body.countPerPage ?? 20)
    const currentPage = Number(body.currentPage ?? 1)
    if (!Number.isFinite(countPerPage) || !Number.isFinite(currentPage)) {
      return json({ error: '요청이 올바르지 않습니다.' }, 400)
    }
    return json({ results: await search(query, countPerPage, currentPage) })
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : '우체국 주소 조회에 실패했습니다.' },
      500,
    )
  }
})
