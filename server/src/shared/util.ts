import { randomBytes } from 'node:crypto'
import type { Db } from '../db.ts'
import { sb } from '../sb.ts'

/** 헷갈리는 글자(0/O, 1/I)를 뺀 코드. 입금자명으로 사람이 옮겨 적기 때문이다. */
export function randomCode(len: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = randomBytes(len)
  let result = ''
  for (const n of buf) result += chars[n % chars.length]
  return result
}

export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const { data } = await sb(db).from('profiles').select('role').eq('id', userId).maybeSingle()
  return data?.role === 'admin'
}

export async function isFarmMember(db: Db, userId: string, farmId: string): Promise<boolean> {
  const { data } = await sb(db).from('farm_members')
    .select('farm_id').eq('farm_id', farmId).eq('user_id', userId).maybeSingle()
  return Boolean(data)
}

export function seoulDateCompact(date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }).replaceAll('-', '')
}
