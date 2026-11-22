import { createServer } from 'node:http'
import { config } from './config.ts'
import { adminPool, appPool, withAdmin, withUser } from './db.ts'
import { functions } from './functions/index.ts'
import { cors, MAX_UPLOAD_BODY, readJson, send, userFrom } from './http.ts'
import { runQuery } from './query.ts'
import { loadSchema } from './schema.ts'
import { serveFile, uploadImage, deleteImage } from './storage.ts'
import { sign } from './jwt.ts'
import { VERSION } from './version.ts'
import { kakaoCallback, kakaoStart } from './kakao.ts'
import { sb } from './sb.ts'
import { startScheduler } from './scheduler.ts'

const server = createServer(async (req, res) => {
  cors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname
  const userId = userFrom(req)

  try {
    if (path === '/health') {
      return send(res, 200, { ok: true })
    }

    // 화면에서 지금 돌고 있는 서버가 무엇인지 보여주기 위한 것.
    if (req.method === 'GET' && path === '/version') {
      return send(res, 200, VERSION)
    }

    // 업로드된 이미지 서빙 (문자 미리보기용 HEAD 포함)
    if ((req.method === 'GET' || req.method === 'HEAD') && path.startsWith('/files/')) {
      return serveFile(req, res, decodeURIComponent(path.slice('/files/'.length)))
    }

    // 데이터 게이트웨이. RLS 가 적용되는 커넥션으로 나간다.
    if (req.method === 'POST' && path === '/query') {
      const body = await readJson(req)
      const result = await withUser(userId, (db) => runQuery(db, body))
      return send(res, 200, { data: result.data, count: result.count, error: null })
    }

    // Edge Function 대체. 이름은 그대로 유지한다.
    if (req.method === 'POST' && path.startsWith('/rpc/')) {
      const name = path.slice('/rpc/'.length)
      const handler = functions[name]
      if (!handler) return send(res, 404, { error: `없는 함수: ${name}` })

      const body = await readJson(req)
      // 크론은 시크릿 헤더로 들어온다. 로그인 없이 실행할 수 있는 유일한 경로.
      const cronSecret = process.env.CRON_SECRET
      if (cronSecret && req.headers['x-cron-secret'] === cronSecret) body.__byCron = true

      const result = await withAdmin((admin) => handler({ userId, body, admin }))
      return send(res, result.status, result.body)
    }

    if (req.method === 'POST' && path === '/storage/upload') {
      const body = await readJson(req, MAX_UPLOAD_BODY)
      const bytes = Buffer.from(String(body.data ?? ''), 'base64')
      const result = await withUser(userId, (db) =>
        uploadImage(db, userId, String(body.path ?? ''), String(body.contentType ?? ''), bytes))
      return send(res, 200, result)
    }

    if (req.method === 'POST' && path === '/storage/delete') {
      const body = await readJson(req)
      await withUser(userId, (db) => deleteImage(db, userId, String(body.path ?? '')))
      return send(res, 200, { ok: true })
    }

    // 카카오 로그인
    if (req.method === 'GET' && path === '/auth/kakao/start') {
      return kakaoStart(res, url.searchParams.get('redirect'))
    }
    if (req.method === 'GET' && path === '/auth/kakao/callback') {
      return kakaoCallback(res, url.searchParams.get('code'), url.searchParams.get('state'))
    }

    // 현재 로그인 사용자
    if (req.method === 'GET' && path === '/auth/me') {
      if (!userId) return send(res, 200, { user: null })
      const profile = await withUser(userId, async (db) =>
        (await sb(db).from('profiles').select('*').eq('id', userId).maybeSingle()).data)
      return send(res, 200, { user: profile ? { id: userId, profile } : null })
    }

    // 카카오 로그인이 붙기 전까지 쓰는 임시 발급구.
    // ALLOW_DEV_LOGIN 이 켜져 있을 때만 동작한다.
    if (req.method === 'POST' && path === '/auth/dev-login') {
      if (process.env.ALLOW_DEV_LOGIN !== 'true') return send(res, 404, { error: '사용할 수 없습니다.' })
      const body = await readJson(req)
      const email = String(body.email ?? '').trim()
      if (!email) return send(res, 400, { error: 'email 이 필요합니다.' })

      const id = await withAdmin(async (db) => {
        const found = await db.query('select id from auth.users where email = $1', [email])
        if (found.rows[0]) return found.rows[0].id as string
        const created = await db.query(
          `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
          [email, JSON.stringify({ nickname: body.name ?? email.split('@')[0] })],
        )
        return created.rows[0].id as string
      })
      return send(res, 200, { token: sign({ sub: id, role: 'authenticated' }), userId: id })
    }

    return send(res, 404, { error: '없는 주소입니다.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return send(res, 400, { error: message })
  }
})

await loadSchema()
server.listen(config.port, '127.0.0.1', () => {
  console.log(`farmassi API v${VERSION.version} (${VERSION.commit}) → http://127.0.0.1:${config.port}`)
  startScheduler()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => { void appPool.end(); void adminPool.end(); process.exit(0) })
  })
}
