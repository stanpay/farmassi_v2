import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase 환경변수가 없습니다.')
  return createClient(url, key)
}

export async function getUserFromRequest(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon) return null
  const client = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data } = await client.auth.getUser()
  return data.user ?? null
}

export function randomCode(len: number) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = crypto.getRandomValues(new Uint8Array(len))
  let result = ''
  for (const n of buf) result += chars[n % chars.length]
  return result
}

export async function isAdmin(admin: SupabaseClient, userId: string) {
  const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  return data?.role === 'admin'
}

export async function isFarmMember(admin: SupabaseClient, userId: string, farmId: string) {
  const { data } = await admin.from('farm_members')
    .select('farm_id').eq('farm_id', farmId).eq('user_id', userId).maybeSingle()
  return Boolean(data)
}
