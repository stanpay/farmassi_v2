import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { config } from './config.ts'
import { withAdmin } from './db.ts'
import { sign } from './jwt.ts'

/**
 * 카카오 로그인.
 *
 * 흐름: /auth/kakao/start → 카카오 동의화면 → /auth/kakao/callback
 *      → 우리 세션 토큰을 만들어 프론트로 ?code=<토큰> 으로 돌려보낸다.
 *
 * 프론트의 AuthCallback 이 원래 `?code=` 를 받아 세션으로 바꾸던 코드를 그대로 쓴다.
 */

const AUTHORIZE = 'https://kauth.kakao.com/oauth/authorize'
const TOKEN = 'https://kauth.kakao.com/oauth/token'
const PROFILE = 'https://kapi.kakao.com/v2/user/me'

/** 돌아갈 주소를 서명해서 state 에 싣는다. 위조된 주소로 튕겨나가지 않게 하려는 것. */
function packState(redirect: string): string {
  const payload = Buffer.from(redirect).toString('base64url')
  const mac = createHmac('sha256', config.jwtSecret).update(payload).digest('base64url')
  return `${payload}.${mac}`
}

function unpackState(state: string): string | null {
  const [payload, mac] = state.split('.')
  if (!payload || !mac) return null
  const expected = createHmac('sha256', config.jwtSecret).update(payload).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return Buffer.from(payload, 'base64url').toString('utf8')
}

/** 안드로이드 앱 카카오 로그인 콜백. Capacitor custom scheme. */
const APP_CALLBACK_PROTOCOL = 'kr.farmassi.app:'

function isAppCallback(url: URL): boolean {
  return url.protocol === APP_CALLBACK_PROTOCOL && url.hostname === 'auth' && url.pathname.startsWith('/callback')
}

/** 우리 사이트 또는 앱으로만 돌려보낸다. 열린 리다이렉트 방지. */
function safeRedirect(raw: string | null): string {
  const fallback = `${config.siteOrigin}/auth/callback`
  if (!raw) return fallback
  try {
    const url = new URL(raw)
    if (isAppCallback(url)) return url.toString()
    const allowed = config.siteOrigins.includes(url.origin) || url.hostname === 'localhost'
    return allowed ? url.toString() : fallback
  } catch {
    return fallback
  }
}

/** 카카오톡 인앱 브라우저는 커스텀 스킴 302 를 무시하는 경우가 있다. */
function sendClientRedirect(res: ServerResponse, target: string): void {
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    res.writeHead(302, { Location: `${config.siteOrigin}/auth/callback` }).end()
    return
  }
  if (!isAppCallback(parsed)) {
    res.writeHead(302, { Location: target }).end()
    return
  }
  const ssp = `${parsed.hostname}${parsed.pathname}${parsed.search}`
  const intent = `intent://${ssp}#Intent;scheme=kr.farmassi.app;package=kr.farmassi.app;end`
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escapeHtml(target)}"><title>팜어시</title></head><body><script>location.replace(${JSON.stringify(target)});setTimeout(function(){location.replace(${JSON.stringify(intent)})},400)</script><p><a href="${escapeHtml(target)}">앱으로 돌아가기</a></p></body></html>`
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function kakaoStart(res: ServerResponse, redirect: string | null): void {
  const params = new URLSearchParams({
    client_id: config.kakao.clientId,
    redirect_uri: config.kakao.redirectUri,
    response_type: 'code',
    scope: 'profile_nickname profile_image',
    state: packState(safeRedirect(redirect)),
  })
  res.writeHead(302, { Location: `${AUTHORIZE}?${params}` }).end()
}

export async function kakaoCallback(
  res: ServerResponse, code: string | null, state: string | null,
): Promise<void> {
  const redirect = state ? unpackState(state) : null
  const target = safeRedirect(redirect)

  const bail = (message: string) => {
    const url = new URL(target)
    url.searchParams.set('error_description', message)
    sendClientRedirect(res, url.toString())
  }

  if (!code) return bail('인가 코드가 없습니다.')

  try {
    const tokenRes = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.kakao.clientId,
        redirect_uri: config.kakao.redirectUri,
        code,
        ...(config.kakao.clientSecret ? { client_secret: config.kakao.clientSecret } : {}),
      }),
    })
    const tokenBody = await tokenRes.json() as { access_token?: string; error_description?: string }
    if (!tokenBody.access_token) return bail(tokenBody.error_description ?? '카카오 토큰 발급에 실패했습니다.')

    const profileRes = await fetch(PROFILE, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    })
    const profile = await profileRes.json() as {
      id?: number
      kakao_account?: { email?: string; profile?: { nickname?: string; profile_image_url?: string } }
    }
    if (!profile.id) return bail('카카오 프로필을 가져오지 못했습니다.')

    const kakaoId = String(profile.id)
    const nickname = profile.kakao_account?.profile?.nickname ?? `사용자${kakaoId.slice(-4)}`
    const avatar = profile.kakao_account?.profile?.profile_image_url ?? null
    const email = profile.kakao_account?.email ?? null

    const userId = await withAdmin(async (db) => {
      const found = await db.query(
        `select user_id from auth.identities where provider = 'kakao' and provider_user_id = $1`,
        [kakaoId],
      )
      if (found.rows[0]) {
        const userId = found.rows[0].user_id as string
        // 프로필을 직접 입력한 사용자의 이름은 유지하고, 사진만 갱신한다.
        await db.query(
          `update public.profiles
             set display_name = case
                   when phone is null or btrim(phone) = '' then $2
                   else display_name
                 end,
                 avatar_url = coalesce($3, avatar_url)
           where id = $1`,
          [userId, nickname, avatar],
        )
        return userId
      }

      // auth.users 에 넣으면 트리거가 public.profiles 를 만든다.
      const created = await db.query(
        `insert into auth.users (email, raw_user_meta_data)
         values ($1, $2) returning id`,
        [email, JSON.stringify({ nickname, avatar_url: avatar, provider: 'kakao' })],
      )
      const id = created.rows[0].id as string
      await db.query(
        `insert into auth.identities (provider, provider_user_id, user_id) values ('kakao', $1, $2)`,
        [kakaoId, id],
      )
      return id
    })

    const needsProfile = await withAdmin(async (db) => {
      const row = await db.query(
        `select phone from public.profiles where id = $1`,
        [userId],
      )
      const phone = row.rows[0]?.phone as string | null | undefined
      return !phone?.trim()
    })

    const url = new URL(target)
    url.searchParams.set('code', sign({ sub: userId, role: 'authenticated' }))
    if (needsProfile) url.searchParams.set('profile', '1')
    sendClientRedirect(res, url.toString())
  } catch (error) {
    bail(error instanceof Error ? error.message : '로그인에 실패했습니다.')
  }
}
