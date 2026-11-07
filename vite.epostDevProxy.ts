/**
 * 로컬 개발(VITE_DEV_BYPASS_AUTH)에서 원격 API 가 꺼져 있어도
 * 우체국 주소 검색을 바로 시험할 수 있게 Vite 가 프록시한다.
 * 키는 서버(.env)에만 두고 브라우저로 내려보내지 않는다.
 */
import type { IncomingMessage } from 'node:http'
import { loadEnv, type Plugin } from 'vite'

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function serviceKey(env: Record<string, string>) {
  const raw = (env.EPOST_SERVICE_KEY ?? '').trim()
  if (!raw) throw new Error('우체국 Open API 키(EPOST_SERVICE_KEY)가 설정되지 않았습니다.')
  return raw.includes('%') ? decodeURIComponent(raw) : raw
}

export function epostDevProxy(): Plugin {
  return {
    name: 'epost-dev-proxy',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '')
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST' || req.url?.split('?')[0] !== '/__dev/epost-address') {
          next()
          return
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          const raw = await readBody(req)
          const body = raw ? (JSON.parse(raw) as {
            query?: string
            countPerPage?: number
            currentPage?: number
          }) : {}
          const query = String(body.query ?? '').trim()
          if (query.length < 2) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '검색어를 입력해 주세요.' }))
            return
          }

          const countPerPage = Math.max(1, Math.min(Number(body.countPerPage ?? 20) || 20, 50))
          const currentPage = Math.max(1, Number(body.currentPage ?? 1) || 1)
          const url = new URL(ENDPOINT)
          url.searchParams.set('serviceKey', serviceKey(env))
          url.searchParams.set('srchwrd', query)
          url.searchParams.set('countPerPage', String(countPerPage))
          url.searchParams.set('currentPage', String(currentPage))

          const upstream = await fetch(url)
          if (!upstream.ok) {
            throw new Error(`우체국 주소 조회 HTTP ${upstream.status}`)
          }
          const results = parseResults(await upstream.text())
          res.statusCode = 200
          res.end(JSON.stringify({ results }))
        } catch (error) {
          res.statusCode = 500
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : '우체국 주소 조회에 실패했습니다.',
            }),
          )
        }
      })
    },
  }
}
