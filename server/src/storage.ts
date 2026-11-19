import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from './config.ts'
import { sb } from './sb.ts'
import type { Db } from './db.ts'

/**
 * Supabase Storage 대체.
 *
 * 원래 정책: 경로의 첫 폴더가 farm_id 이고, 그 농가의 구성원만 쓸 수 있다.
 * 여기서도 같은 규칙을 적용한다.
 */

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function isFarmMember(db: Db, userId: string, farmId: string): Promise<boolean> {
  const { data } = await sb(db).from('farm_members')
    .select('farm_id').eq('farm_id', farmId).eq('user_id', userId).maybeSingle()
  if (data) return true
  const { data: profile } = await sb(db).from('profiles').select('role').eq('id', userId).maybeSingle()
  return profile?.role === 'admin'
}

export async function uploadImage(
  db: Db, userId: string | null, path: string, contentType: string, bytes: Buffer,
): Promise<{ url: string; path: string }> {
  if (!userId) throw new Error('로그인이 필요합니다.')

  // 프론트가 정한 경로를 그대로 쓴다. 단 첫 폴더는 반드시 농가 id 여야 하고,
  // 그 농가의 구성원만 쓸 수 있다. Supabase Storage 정책과 같은 규칙이다.
  const safe = safePath(path)
  const farmId = safe.split('/')[0]
  if (!UUID.test(farmId)) throw new Error('경로의 첫 폴더는 농가 식별자여야 합니다.')
  if (!(await isFarmMember(db, userId, farmId))) throw new Error('이 농가에 업로드할 권한이 없습니다.')

  const ext = ALLOWED[contentType]
  if (!ext) throw new Error('jpg, png, webp, gif 만 올릴 수 있습니다.')
  if (extname(safe).toLowerCase() !== ext && !(ext === '.jpg' && extname(safe).toLowerCase() === '.jpeg')) {
    throw new Error('확장자와 파일 형식이 다릅니다.')
  }
  if (bytes.length === 0) throw new Error('빈 파일입니다.')
  if (bytes.length > MAX_BYTES) throw new Error('5MB 이하만 올릴 수 있습니다.')

  const full = join(config.uploadDir, safe)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, bytes)

  return { url: `${config.publicUploadBase}/${safe}`, path: safe }
}

export async function deleteImage(db: Db, userId: string | null, path: string): Promise<void> {
  if (!userId) throw new Error('로그인이 필요합니다.')
  const safe = safePath(path)
  const farmId = safe.split('/')[0]
  if (!UUID.test(farmId)) throw new Error('경로가 올바르지 않습니다.')
  if (!(await isFarmMember(db, userId, farmId))) throw new Error('삭제 권한이 없습니다.')
  await unlink(join(config.uploadDir, safe)).catch(() => {})
}

/** 상위 디렉터리로 빠져나가는 경로를 막는다. */
function safePath(input: string): string {
  const cleaned = normalize(input).replace(/^(\.\.(\/|\\|$))+/, '')
  if (cleaned.startsWith('/') || cleaned.includes('..')) throw new Error('경로가 올바르지 않습니다.')
  return cleaned
}

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
}

/** 업로드된 파일을 공개로 내보낸다. nginx 를 거치지 않는 경로에서도 동작하도록. */
export async function serveFile(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  let full: string
  try {
    full = join(config.uploadDir, safePath(path))
  } catch {
    res.writeHead(400).end(); return
  }
  try {
    const info = await stat(full)
    if (!info.isFile()) throw new Error('not a file')
    const headers = {
      'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
      // 문자(iMessage 등) 미리보기가 이미지 존재 확인에 HEAD 를 쓰는 경우가 있다.
      Allow: 'GET, HEAD, OPTIONS',
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, headers)
      res.end()
      return
    }
    res.writeHead(200, headers)
    createReadStream(full).pipe(res)
  } catch {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: '파일을 찾을 수 없습니다.' }))
  }
}
