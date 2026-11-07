/**
 * 자체 API 클라이언트.
 *
 * 기존 Supabase 클라이언트와 같은 모양을 유지한다. 화면 20여 곳이
 * `supabase.from('orders').select('*').eq(...)` 형태로 쓰여 있어서,
 * 그 코드를 건드리지 않기 위해 문법을 그대로 흉내낸다.
 */

const API = import.meta.env.VITE_API_URL ?? 'https://api.shop.lkim.me'
const TOKEN_KEY = 'farmassi-token'

export interface User { id: string }
export interface Session { access_token: string; user: User }
export interface ApiError { message: string }
export interface Result<T = any> { data: T; error: ApiError | null; count?: number }

// --- 세션 -----------------------------------------------------------------

let cachedSession: Session | null = null
const listeners = new Set<(session: Session | null) => void>()

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  cachedSession = token ? { access_token: token, user: { id: userIdFrom(token) } } : null
  for (const listener of listeners) listener(cachedSession)
}

/** 토큰 본문에서 sub 를 꺼낸다. 서명 검증은 서버가 한다. */
function userIdFrom(token: string): string {
  try {
    const body = token.split('.')[1]
    return JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? ''
  } catch {
    return ''
  }
}

/**
 * 통신 실패를 화면 어딘가에는 반드시 알린다.
 *
 * 조회하는 화면 상당수가 { data } 만 꺼내 쓰고 error 를 보지 않는다. 그러면 서버가
 * 죽어도 "주문이 없습니다" 처럼 보여서 사용자가 원인을 알 수 없다. 실패한 요청은
 * 여기서 이벤트로 알리고, 앱 한 곳에서 받아 띄운다.
 * RLS 로 결과가 비는 것은 실패가 아니므로 여기 걸리지 않는다.
 */
export const API_ERROR_EVENT = 'farmassi:api-error'

function announceFailure(message: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(API_ERROR_EVENT, { detail: message }))
}

async function request(path: string, body?: unknown, method = 'POST'): Promise<any> {
  const token = getToken()
  let response: Response
  try {
    response = await fetch(API + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    })
  } catch {
    const message = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    announceFailure(message)
    throw new Error(message)
  }
  const payload = await response.json().catch(() => ({ error: '응답을 읽지 못했습니다.' }))
  if (!response.ok) {
    const message = payload.error ?? `요청 실패 (${response.status})`
    announceFailure(message)
    throw new Error(message)
  }
  return payload
}

// --- 쿼리 빌더 -------------------------------------------------------------

type FilterOp = 'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'is'

class Builder implements PromiseLike<Result> {
  private body: any

  constructor(table: string) {
    this.body = { table, op: 'select' }
  }

  select(columns = '*', options?: { count?: 'exact'; head?: boolean }) {
    this.body.select = columns
    if (options?.count) this.body.count = options.count
    if (options?.head) this.body.head = true
    if (this.body.op !== 'select') this.body.returning = true
    return this
  }
  insert(values: unknown) { this.body.op = 'insert'; this.body.values = values; return this }
  upsert(values: unknown, options?: { onConflict?: string }) {
    this.body.op = 'upsert'; this.body.values = values
    if (options?.onConflict) this.body.onConflict = options.onConflict
    return this
  }
  update(values: unknown) { this.body.op = 'update'; this.body.values = values; return this }
  delete() { this.body.op = 'delete'; return this }

  private filter(column: string, op: FilterOp, value: unknown) {
    ;(this.body.filters ??= []).push({ column, op, value })
    return this
  }
  eq(c: string, v: unknown) { return this.filter(c, 'eq', v) }
  neq(c: string, v: unknown) { return this.filter(c, 'neq', v) }
  in(c: string, v: unknown[]) { return this.filter(c, 'in', v) }
  gt(c: string, v: unknown) { return this.filter(c, 'gt', v) }
  gte(c: string, v: unknown) { return this.filter(c, 'gte', v) }
  lt(c: string, v: unknown) { return this.filter(c, 'lt', v) }
  lte(c: string, v: unknown) { return this.filter(c, 'lte', v) }
  is(c: string, v: unknown) { return this.filter(c, 'is', v) }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    ;(this.body.order ??= []).push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst,
    })
    return this
  }
  limit(n: number) { this.body.limit = n; return this }
  single() { this.body.single = 'one'; return this }
  maybeSingle() { this.body.single = 'maybe'; return this }

  private async run(): Promise<Result> {
    try {
      const payload = await request('/query', this.body)
      return { data: payload.data, error: null, ...(payload.count !== null ? { count: payload.count } : {}) } as Result
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
    }
  }

  then<A, B>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
             onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected)
  }
}

// --- 스토리지 --------------------------------------------------------------

const PUBLIC_BASE = import.meta.env.VITE_PUBLIC_UPLOAD_BASE ?? `${API}/files`

async function toBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function storageBucket() {
  return {
    async upload(
      path: string,
      file: File,
      options?: { contentType?: string; cacheControl?: string; upsert?: boolean },
    ) {
      try {
        await request('/storage/upload', {
          path,
          contentType: options?.contentType ?? file.type,
          data: await toBase64(file),
        })
        return { data: { path }, error: null }
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
      }
    },
    getPublicUrl(path: string) {
      return { data: { publicUrl: `${PUBLIC_BASE}/${path}` } }
    },
    async remove(paths: string[]) {
      try {
        for (const path of paths) await request('/storage/delete', { path })
        return { data: null, error: null }
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
      }
    },
  }
}

// --- 클라이언트 ------------------------------------------------------------

/**
 * 실시간 구독 대체.
 *
 * 원래는 Postgres 논리복제로 INSERT 를 밀어줬다. 여기서는 주기적으로 다시 조회해서
 * 새로 생긴 행만 골라 같은 모양으로 넘긴다. 알림 배지 용도에는 이 정도면 충분하다.
 */
const POLL_MS = 15000

function channel(_name: string) {
  let timer: ReturnType<typeof setInterval> | null = null
  let watching: { table: string; column?: string; value?: string } | null = null
  let handler: ((payload: { new: any }) => void) | null = null
  const seen = new Set<string>()
  let primed = false

  return {
    on(
      _event: string,
      options: { event?: string; schema?: string; table: string; filter?: string },
      callback: (payload: { new: any }) => void,
    ) {
      const [column, rest] = (options.filter ?? '').split('=')
      watching = { table: options.table, column: column || undefined, value: rest?.replace(/^eq\./, '') }
      handler = callback
      return this
    },
    subscribe() {
      const tick = async () => {
        if (!watching || !handler) return
        let query = new Builder(watching.table).select('*').order('created_at', { ascending: false }).limit(20)
        if (watching.column && watching.value) query = query.eq(watching.column, watching.value)
        const { data, error } = await query
        if (error || !Array.isArray(data)) return
        // 첫 조회는 기존 행을 기록만 한다. 새로고침마다 알림이 다시 뜨지 않게.
        for (const row of data) {
          if (!seen.has(row.id)) {
            seen.add(row.id)
            if (primed) handler({ new: row })
          }
        }
        primed = true
      }
      void tick()
      timer = setInterval(() => void tick(), POLL_MS)
      return this
    },
    unsubscribe() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}

export const supabase = {
  from: (table: string) => new Builder(table),

  channel,
  removeChannel(target: { unsubscribe: () => void }) {
    target?.unsubscribe?.()
  },

  storage: { from: (_bucket: string) => storageBucket() },

  functions: {
    async invoke(name: string, options?: { body?: unknown }) {
      try {
        return { data: await request(`/rpc/${name}`, options?.body ?? {}), error: null }
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
      }
    },
  },

  auth: {
    async getSession(): Promise<{ data: { session: Session | null } }> {
      const token = getToken()
      if (!token) return { data: { session: null } }
      if (!cachedSession) cachedSession = { access_token: token, user: { id: userIdFrom(token) } }
      return { data: { session: cachedSession } }
    },

    async signInWithOAuth(
      options: { provider: string; options?: { redirectTo?: string; scopes?: string } },
    ): Promise<{ error: ApiError | null }> {
      const redirect = options.options?.redirectTo ?? `${window.location.origin}/auth/callback`
      const start = `${API}/auth/${options.provider}/start?redirect=${encodeURIComponent(redirect)}`
      // 앱 WebView 안에서 카카오 동의 화면까지 진행한다. 허용 목록에 없는 주소는 바깥 브라우저가 연다.
      window.location.assign(start)
      return { error: null }
    },

    /** 로그인 후 돌아온 주소에서 토큰을 받아 세션을 만든다. */
    async exchangeCodeForSession(
      tokenOrCode: string,
    ): Promise<{ data: { session: Session | null }; error: ApiError | null }> {
      setToken(tokenOrCode)
      return { data: { session: cachedSession }, error: null }
    },

    async signOut() {
      setToken(null)
      return { error: null }
    },

    onAuthStateChange(callback: (event: string, session: Session | null) => void) {
      const listener = (session: Session | null) =>
        callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session)
      listeners.add(listener)
      return {
        data: { subscription: { unsubscribe: () => { listeners.delete(listener) } } },
      }
    },
  },
}
