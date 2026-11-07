/**
 * 로컬 개발(VITE_DEV_BYPASS_AUTH)에서 원격 API 가 꺼져 있어도
 * 도로명주소 건물(동·호) 조회를 바로 시험할 수 있게 Vite 가 프록시한다.
 * 키는 .env 에만 두고 브라우저로 내려보내지 않는다.
 */
import type { IncomingMessage } from 'node:http'
import { loadEnv, type Plugin } from 'vite'
import { jusoRoadBase, lookupJusoBuilding } from './server/src/functions/jusoBuildingLookup.ts'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function jusoDevProxy(): Plugin {
  return {
    name: 'juso-dev-proxy',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '')
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'POST' || req.url?.split('?')[0] !== '/__dev/juso-building') {
          next()
          return
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          const raw = await readBody(req)
          const body = raw ? (JSON.parse(raw) as { address?: string; dong?: string }) : {}
          const road = jusoRoadBase(String(body.address ?? ''))
          if (road.length < 2) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '주소를 입력해 주세요.' }))
            return
          }
          const info = await lookupJusoBuilding(road, String(body.dong ?? '').trim(), {
            searchKey: (env.JUSO_SEARCH_API_KEY ?? '').trim(),
            detailKey: (env.JUSO_DETAIL_API_KEY ?? '').trim(),
          })
          res.statusCode = 200
          res.end(JSON.stringify(info))
        } catch (error) {
          res.statusCode = 500
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : '도로명주소 조회에 실패했습니다.',
            }),
          )
        }
      })
    },
  }
}
