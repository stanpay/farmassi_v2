// 카카오 챗봇 스킬 서버 (Supabase Edge Function)
// - 요청 헤더 x-skill-token 으로 카카오 스킬 요청만 받습니다.
// - 사용자(botUserKey, plusfriendUserKey, appUserId)와 모든 대화를 저장합니다.
// - 콜백이 켜진 블록이면 바로 useCallback 으로 답하고, 실제 답은 callbackUrl 로 보냅니다.
// - 답은 Claude 가 만듭니다. 운영 DB 는 api.shop.lkim.me/chatbot/query(읽기 전용)로 조회합니다.
//   명세: doc/kakao-chatbot/developer-handoff.md
// - 농가 회원이 보낸 주문은 /chatbot/rpc/review-farm-orders 로 검수하고, 사용자가 확인하면
//   /chatbot/rpc/create-farm-orders 로 등록합니다. 검수 중간 상태는 kakao_order_drafts 에 둡니다.
//
// 시크릿: KAKAO_SKILL_TOKEN, ANTHROPIC_API_KEY, CHATBOT_API_KEY
// 선택:   CHATBOT_QUERY_URL (기본 https://api.shop.lkim.me/chatbot/query)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
// SDK 는 콜백 응답을 보낸 뒤에 불러온다(claude() 참고). 타입만 여기서 가져온다.
import type Anthropic from "npm:@anthropic-ai/sdk@1.12.0";

const WAIT_TEXT = "확인하고 있어요. 잠시만 기다려 주세요.";
const ERROR_TEXT = "죄송해요, 잠시 문제가 생겼어요. 조금 뒤에 다시 말씀해 주세요.";
const BUSY_TEXT = "확인할 내용이 많아 답변이 늦어지고 있어요. 조금 뒤에 다시 물어봐 주세요.";

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 8;          // Claude ↔ 도구 왕복 최대 횟수
const DEADLINE_MS = 110_000;        // Edge Function 실행 한도(무료 150초) 안에서 끝내기
const HISTORY_ROWS = 2;             // 처음엔 직전 한 번의 대화(고객 질문 + 봇 답)만 넘김. 더는 get_history 로
const HISTORY_PAGE_MAX = 20;        // get_history 한 번에 최대 몇 건
const KAKAO_TEXT_LIMIT = 1000;      // simpleText 말풍선 하나의 최대 글자 수
const KAKAO_MAX_BUBBLES = 3;        // 한 응답에 보낼 수 있는 말풍선 수
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;   // 주문 검수 내용을 보관하는 시간
const CANDIDATE_VIEW_MAX = 10;      // Claude 에게 보여 줄 주소·상품 후보 수

// 요청마다 읽음(시크릿 변경 즉시 반영). 붙여넣기로 딸려 온 줄바꿈은 무시.
const env = (name: string) => (Deno.env.get(name) ?? "").trim();
const queryUrl = () => env("CHATBOT_QUERY_URL") || "https://api.shop.lkim.me/chatbot/query";

type SkillResponse = Record<string, unknown>;

// 긴 답은 줄 경계에서 잘라 말풍선 여러 개로 보낸다(주문 검수 내용처럼 목록이 길 때).
function splitForKakao(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > KAKAO_TEXT_LIMIT && chunks.length < KAKAO_MAX_BUBBLES - 1) {
    let cut = rest.lastIndexOf("\n\n", KAKAO_TEXT_LIMIT);
    if (cut < KAKAO_TEXT_LIMIT * 0.4) cut = rest.lastIndexOf("\n", KAKAO_TEXT_LIMIT);
    if (cut < KAKAO_TEXT_LIMIT * 0.4) cut = KAKAO_TEXT_LIMIT;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > KAKAO_TEXT_LIMIT) rest = rest.slice(0, KAKAO_TEXT_LIMIT - 1) + "…";
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : [ERROR_TEXT];
}

function simpleText(text: string): SkillResponse {
  return {
    version: "2.0",
    template: { outputs: splitForKakao(text).map((t) => ({ simpleText: { text: t } })) },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function replyText(res: SkillResponse): string | null {
  // deno-lint-ignore no-explicit-any
  const outputs = (res as any)?.template?.outputs ?? [];
  // deno-lint-ignore no-explicit-any
  return outputs.map((o: any) => o?.simpleText?.text).filter(Boolean).join("\n") || null;
}

interface Ctx {
  db: SupabaseClient;
  kakaoUserId: string | null;
  inMessageId: number | null;
  appUserId: string | null;
  utterance: string;
  meta: Record<string, unknown>;   // 답장 행의 raw.claude 로 저장
  historyBeforeId: number | null;  // get_history 가 이 id 보다 오래된 대화를 읽음
  memberUserId: string | null;     // 매칭된 팜어시 회원 (없으면 null)
  draft: Draft | null;             // 진행 중인 주문 검수
  draftRev: number;                // 마지막으로 읽거나 쓴 검수 내용의 rev (0 = 없음)
  saveAllowed: boolean;            // 이번 메시지를 받기 전에 이미 전부 ok 였는지(사용자가 확인 질문을 본 상태)
  draftChanged: boolean;           // 이번 메시지를 처리하면서 검수 내용이 바뀌었는지
  rpcLog: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// 운영 DB 조회 (api.shop.lkim.me/chatbot/query)

interface SqlResult {
  ok: boolean;
  status: number;
  body: string;   // 응답 JSON 원문(오류 포함). Claude 에게 그대로 준다.
}

async function runSql(sql: string, params: unknown[] = []): Promise<SqlResult> {
  try {
    const r = await fetch(queryUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-chatbot-key": env("CHATBOT_API_KEY") },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body: body.slice(0, 30_000) };
  } catch (e) {
    return { ok: false, status: 0, body: JSON.stringify({ error: { code: "network", message: String(e) } }) };
  }
}

// 스키마는 워커가 살아 있는 동안 한 번만 읽는다. 실패하면 다음 요청에서 다시 시도.
let schemaCache: string | null = null;

async function loadSchema(): Promise<string> {
  if (schemaCache) return schemaCache;
  const r = await runSql(`
    select c.table_schema || '.' || c.table_name as t,
           string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as cols
    from information_schema.columns c
    where c.table_schema in ('public', 'auth')
    group by 1 order by 1`);
  if (!r.ok) return `(스키마를 불러오지 못했습니다: HTTP ${r.status} ${r.body.slice(0, 300)})`;
  const parsed = JSON.parse(r.body) as { rows: [string, string][] };
  schemaCache = parsed.rows.map(([t, cols]) => `- ${t}: ${cols}`).join("\n");
  return schemaCache;
}

interface Member {
  user_id: string;
  display_name: string | null;
  role: string | null;
}

async function findMember(appUserId: string | null): Promise<Member | null | "error"> {
  if (!appUserId) return null;
  const r = await runSql(
    `select i.user_id, p.display_name, p.role
       from auth.identities i left join public.profiles p on p.id = i.user_id
      where i.provider = 'kakao' and i.provider_user_id = $1
      limit 1`,
    [appUserId],
  );
  if (!r.ok) return "error";
  const parsed = JSON.parse(r.body) as { rows: [string, string | null, string | null][] };
  const row = parsed.rows[0];
  return row ? { user_id: row[0], display_name: row[1], role: row[2] } : null;
}

// ---------------------------------------------------------------------------
// 주문 검수·등록 (농가 회원이 카톡으로 보낸 주문)
//
// 백엔드 /chatbot/rpc/review-farm-orders · create-farm-orders 를 부른다.
// 명세: develop 브랜치 doc/chatbot/order-review.md, doc/backend/orders/command/review-farm-orders.md
// - 검수 API 는 상태를 저장하지 않는다. 직전 응답의 orders 를 kakao_order_drafts 에 통째로 보관했다가
//   그대로 돌려보낸다. (addressToken 같은 서버 서명 값이 Claude 를 거치지 않게 한다)
// - 누구 권한으로 실행할지(kakaoUserId)는 카카오가 보낸 appUserId 로만 정한다. Claude 입력에서 받지 않는다.
// - 등록(save_orders)은 "전부 ok 인 상태를 사용자가 한 번 본 다음 메시지"에서만 된다. 코드로 막는다.

// deno-lint-ignore no-explicit-any
type Json = any;

interface Draft {
  farm_id: string | null;
  farm_name: string | null;
  pending_text: string | null;      // 농가를 못 정해 아직 검수하지 못한 원문
  orders: Json[];                   // review 응답의 orders 그대로
  summary: { total: number; ready: number; needsFix: number } | null;
  save_request: Json | null;        // 전부 ok 일 때만
  saving_at: string | null;         // 등록 요청을 보냈는데 결과를 모르는 상태
  rev: number;
  updated_at: string;
}

const DRAFT_COLS = "farm_id, farm_name, pending_text, orders, summary, save_request, saving_at, rev, updated_at";

function emptyDraft(): Draft {
  return { farm_id: null, farm_name: null, pending_text: null, orders: [], summary: null,
    save_request: null, saving_at: null, rev: 0, updated_at: "" };
}

function allOk(d: Draft | null): boolean {
  return !!d && d.orders.length > 0 && !!d.save_request && d.summary?.needsFix === 0;
}

async function readDraft(ctx: Ctx): Promise<Draft | null> {
  if (!ctx.kakaoUserId) return null;
  const { data, error } = await ctx.db.from("kakao_order_drafts").select(DRAFT_COLS)
    .eq("kakao_user_id", ctx.kakaoUserId).maybeSingle();
  if (error) console.error("read draft failed", error);
  if (error || !data) return null;
  if (Date.now() - new Date(data.updated_at).getTime() > DRAFT_TTL_MS) {
    await ctx.db.from("kakao_order_drafts").delete().eq("kakao_user_id", ctx.kakaoUserId);
    return null;
  }
  return { ...data, orders: Array.isArray(data.orders) ? data.orders : [], rev: Number(data.rev) || 0 } as Draft;
}

// DB 의 최신 내용으로 맞춘다. 이번 턴에 알던 것과 다르면(다른 메시지가 그사이 바꿨으면) true.
async function syncDraft(ctx: Ctx): Promise<boolean> {
  const fresh = await readDraft(ctx);
  const changed = (fresh?.rev ?? 0) !== ctx.draftRev;
  ctx.draft = fresh;
  ctx.draftRev = fresh?.rev ?? 0;
  return changed;
}

async function writeDraft(ctx: Ctx, draft: Draft): Promise<string | null> {
  if (!ctx.kakaoUserId) return "대화 사용자 정보를 저장하지 못해 검수 내용을 보관할 수 없습니다.";
  const rev = Math.max(Date.now(), ctx.draftRev + 1);
  const updatedAt = new Date().toISOString();
  const { error } = await ctx.db.from("kakao_order_drafts").upsert({
    kakao_user_id: ctx.kakaoUserId,
    farm_id: draft.farm_id,
    farm_name: draft.farm_name,
    pending_text: draft.pending_text,
    orders: draft.orders,
    summary: draft.summary,
    save_request: draft.save_request,
    saving_at: draft.saving_at,
    rev,
    updated_at: updatedAt,
  }, { onConflict: "kakao_user_id" });
  if (error) {
    console.error("write draft failed", error);
    return `검수 내용을 보관하지 못했습니다: ${error.message}`;
  }
  ctx.draft = { ...draft, rev, updated_at: updatedAt };
  ctx.draftRev = rev;
  ctx.draftChanged = true;
  return null;
}

async function dropDraft(ctx: Ctx): Promise<void> {
  if (ctx.kakaoUserId) {
    await ctx.db.from("kakao_order_drafts").delete().eq("kakao_user_id", ctx.kakaoUserId);
  }
  ctx.draft = null;
  ctx.draftRev = 0;
  ctx.draftChanged = true;
}

interface RpcResult {
  ok: boolean;
  status: number;   // 0 = 응답을 못 받음(시간 초과·네트워크)
  data: Json;
}

async function callRpc(
  ctx: Ctx,
  name: "review-farm-orders" | "create-farm-orders",
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<RpcResult> {
  if (!ctx.appUserId) {
    return { ok: false, status: 0, data: { code: "no_kakao_id",
      error: "카카오 회원번호(appUserId)를 받지 못했습니다. 팜어시에 카카오로 로그인한 계정으로만 쓸 수 있습니다." } };
  }
  const started = Date.now();
  let result: RpcResult;
  try {
    const r = await fetch(new URL(`/chatbot/rpc/${name}`, queryUrl()), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-chatbot-key": env("CHATBOT_API_KEY") },
      body: JSON.stringify({ ...body, kakaoUserId: ctx.appUserId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await r.text();
    let data: Json;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 500) };
    }
    result = { ok: r.ok, status: r.status, data };
  } catch (e) {
    result = { ok: false, status: 0, data: { code: "network", error: String(e) } };
  }
  ctx.rpcLog.push({
    name,
    action: body.action ?? (name === "create-farm-orders" ? "create" : "text"),
    status: result.status,
    code: result.data?.code ?? null,
    ms: Date.now() - started,
  });
  return result;
}

function errBody(r: RpcResult): Record<string, unknown> {
  return r.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : { error: String(r.data) };
}

// 빈 값은 빼서 Claude 에게 넘기는 양을 줄인다.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const res: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    res[k] = v;
  }
  return res;
}

// Claude 에게 보여 주는 주문 한 건. 서명·원문 덩어리는 빼고, 후보에는 고를 번호(no)를 붙인다.
function orderView(o: Json): Record<string, unknown> {
  const f = o?.fields ?? {};
  const bad = o?.status !== "ok";
  const addr: Json[] = Array.isArray(o?.addressCandidates) ? o.addressCandidates : [];
  const prod: Json[] = Array.isArray(o?.productCandidates) ? o.productCandidates : [];
  return compact({
    no: o?.index,
    status: o?.status,
    recipient: f.recipientName,
    phone: f.phone,
    zonecode: f.zonecode,
    address: f.address,
    address_detail: f.addressDetail,
    address_in_message: bad ? f.addressRaw : "",
    product: f.productName,
    product_in_message: f.productQuery,
    unit_price: f.unitPrice || null,
    quantity: f.quantity,
    sender: f.senderName,
    sender_phone: f.senderPhone,
    depositor: f.depositorName,
    memo: f.memo,
    errors: (Array.isArray(o?.errors) ? o.errors : [])
      .map((e: Json) => ({ field: e?.field, code: e?.code, message: e?.message })),
    address_candidates: bad
      ? addr.slice(0, CANDIDATE_VIEW_MAX)
        .map((c, i) => compact({ no: i + 1, zip: c?.zipNo, road: c?.roadAddress, jibun: c?.jibunAddress }))
      : [],
    address_candidates_total: bad && addr.length > CANDIDATE_VIEW_MAX ? addr.length : null,
    product_candidates: prod.slice(0, CANDIDATE_VIEW_MAX)
      .map((c, i) => compact({ no: i + 1, name: c?.name, unit: c?.unit, price: c?.price })),
  });
}

function draftView(d: Draft): Record<string, unknown> {
  return compact({
    farm: d.farm_id || d.farm_name ? compact({ id: d.farm_id, name: d.farm_name }) : null,
    summary: d.summary,
    all_ok: d.orders.length ? allOk(d) : null,
    orders: d.orders.map(orderView),
    waiting_farm_choice: d.pending_text
      ? "농가가 정해지지 않아 검수하지 못한 주문 원문이 보관돼 있음 (review_orders source=pending, farm_id 지정)"
      : "",
    save_in_doubt: d.saving_at
      ? "등록 요청을 보냈지만 결과를 확인하지 못했음. 중복 등록 주의 (save_orders 응답의 안내를 따를 것)"
      : "",
  });
}

async function resolveFarm(ctx: Ctx, farmId: string | null): Promise<{ id: string | null; name: string | null }> {
  if (farmId) {
    const r = await runSql(`select name from public.farms where id::text = $1`, [farmId]);
    if (!r.ok) return { id: farmId, name: null };
    const rows = (JSON.parse(r.body) as { rows: [string][] }).rows;
    return { id: farmId, name: rows[0]?.[0] ?? null };
  }
  // farmId 없이 통과했다면 서버가 "회원의 농가가 하나뿐"이라 그 농가로 채운 것이다.
  if (!ctx.memberUserId) return { id: null, name: null };
  const r = await runSql(
    `select f.id::text, f.name from public.farm_members m join public.farms f on f.id = m.farm_id
      where m.user_id::text = $1`,
    [ctx.memberUserId],
  );
  if (!r.ok) return { id: null, name: null };
  const rows = (JSON.parse(r.body) as { rows: [string, string][] }).rows;
  return rows.length === 1 ? { id: rows[0][0], name: rows[0][1] } : { id: null, name: null };
}

// review-farm-orders 응답을 검수 내용으로 보관한다.
// farmId 는 이번 검수에 쓴 농가. 모르면(서버가 채운 경우) 응답이나 회원의 농가에서 찾는다.
// 예전 검수의 농가를 물려받지 않는다(다른 농가였을 수 있다).
async function storeReview(ctx: Ctx, data: Json, farmId: string | null): Promise<string | null> {
  const prev = ctx.draft;
  let id: string | null = farmId ?? data?.saveRequest?.farmId ?? null;
  let name: string | null = id && id === prev?.farm_id ? prev?.farm_name ?? null : null;
  if (!id || !name) {
    const farm = await resolveFarm(ctx, id);
    id = farm.id ?? id;
    name = farm.name;
  }
  return await writeDraft(ctx, {
    farm_id: id,
    farm_name: name,
    pending_text: null,
    orders: Array.isArray(data?.orders) ? data.orders : [],
    summary: data?.summary ?? null,
    save_request: data?.saveRequest ?? null,
    saving_at: null,
    rev: 0,
    updated_at: "",
  });
}

type ToolOut = [content: string, isError: boolean];
const out = (obj: Record<string, unknown>, isError = false): ToolOut => [JSON.stringify(obj), isError];

// 검수 내용을 고치는 도구들의 공통 준비. 문제가 있으면 Claude 에게 돌려줄 응답을 준다.
async function needDraft(ctx: Ctx): Promise<ToolOut | null> {
  if (await syncDraft(ctx)) {
    return out({ ok: false, code: "changed",
      error: "검수 내용이 방금 다른 메시지로 바뀌었습니다. 현재 상태를 보고 다시 판단하세요.",
      review: ctx.draft ? draftView(ctx.draft) : null }, true);
  }
  if (!ctx.draft || !ctx.draft.orders.length) {
    return out({ ok: false, code: "no_review",
      error: "진행 중인 주문 검수가 없습니다. 먼저 review_orders 로 검수하세요." }, true);
  }
  return null;
}

// 주문 번호(no, 1부터) → orders 배열 위치(0부터). 범위를 벗어나면 -1.
function orderAt(ctx: Ctx, orderNo: unknown): number {
  const i = Number(orderNo) - 1;
  return Number.isInteger(i) && i >= 0 && i < (ctx.draft?.orders.length ?? 0) ? i : -1;
}

// 보관 중인 orders 를 그대로 돌려보내 다시 검수하고, 결과를 보관한다.
async function reReview(ctx: Ctx, body: Record<string, unknown>, orders?: Json[]): Promise<ToolOut> {
  const d = ctx.draft!;
  const r = await callRpc(ctx, "review-farm-orders",
    { ...(d.farm_id ? { farmId: d.farm_id } : {}), ...body, orders: orders ?? d.orders }, 60_000);
  if (!r.ok) return out({ ok: false, status: r.status, ...errBody(r), note: "검수 내용은 바뀌지 않았습니다." }, true);
  const err = await storeReview(ctx, r.data, d.farm_id);
  if (err) return out({ ok: false, error: err }, true);
  return out({ ok: true, review: draftView(ctx.draft!) });
}

async function toolReviewOrders(ctx: Ctx, input: Json): Promise<ToolOut> {
  const source = String(input?.source ?? "current_message");
  const append = input?.append === true;
  const text = source === "text"
    ? String(input?.text ?? "")
    : source === "pending"
    ? (ctx.draft?.pending_text ?? "")
    : ctx.utterance;
  if (text.trim().length < 2) {
    return out({ ok: false,
      error: source === "pending" ? "보관된 주문 원문이 없습니다." : "주문 원문이 비어 있습니다." }, true);
  }
  const askedFarm = typeof input?.farm_id === "string" && input.farm_id.trim() ? input.farm_id.trim() : null;
  const farmId: string | null = askedFarm ?? (append ? ctx.draft?.farm_id ?? null : null);

  const r = await callRpc(ctx, "review-farm-orders", { text, ...(farmId ? { farmId } : {}) }, 100_000);
  if (!r.ok) {
    const code = r.data?.code;
    if (code === "farm_required" || code === "no_farm") {
      // 농가를 정한 뒤 같은 원문으로 다시 검수할 수 있게 보관한다.
      await syncDraft(ctx);
      await writeDraft(ctx, { ...(ctx.draft ?? emptyDraft()), pending_text: text });
    }
    return out({ ok: false, status: r.status, ...errBody(r) }, true);
  }

  let data = r.data;
  const found: Json[] = Array.isArray(data?.orders) ? data.orders : [];
  const ignored: string[] = Array.isArray(data?.ignored)
    ? data.ignored.slice(0, 10).map((s: Json) => String(s).slice(0, 200))
    : [];
  if (!found.length) {
    return out(compact({ ok: true, orders_found: 0, ignored,
      note: "주문으로 읽힌 내용이 없습니다. 검수 내용은 바뀌지 않았습니다." }));
  }

  // 그사이 다른 메시지가 검수 내용을 바꿨으면 덮어쓰지 않고 합친다.
  const concurrent = await syncDraft(ctx);
  const base: Json[] = append || concurrent ? (ctx.draft?.orders ?? []) : [];
  if (base.length) {
    const baseFarm = ctx.draft?.farm_id ?? null;
    if (askedFarm && baseFarm && askedFarm !== baseFarm) {
      return out({ ok: false, code: "farm_mismatch",
        error: "진행 중인 검수는 다른 농가의 주문입니다. 먼저 등록하거나 취소한 뒤 다시 검수하세요.",
        review: draftView(ctx.draft!) }, true);
    }
    const fid = farmId ?? baseFarm;
    const r2 = await callRpc(ctx, "review-farm-orders",
      { action: "recheck", orders: [...base, ...found], ...(fid ? { farmId: fid } : {}) }, 60_000);
    if (!r2.ok) {
      return out({ ok: false, status: r2.status, ...errBody(r2),
        note: "기존 검수 내용과 합치지 못했습니다. 검수 내용은 바뀌지 않았습니다." }, true);
    }
    data = r2.data;
  }
  const err = await storeReview(ctx, data, farmId ?? (base.length ? ctx.draft?.farm_id ?? null : null));
  if (err) return out({ ok: false, error: err }, true);
  return out(compact({ ok: true, orders_found: found.length, merged_with_existing: base.length || null, ignored,
    review: draftView(ctx.draft!) }));
}

async function toolSelectAddress(ctx: Ctx, input: Json): Promise<ToolOut> {
  const bad = await needDraft(ctx);
  if (bad) return bad;
  const i = orderAt(ctx, input?.order_no);
  if (i < 0) return out({ ok: false, error: "order_no 는 검수 내용의 주문 번호(no)입니다." }, true);
  const no = Number(input?.candidate_no);
  if (!Number.isInteger(no) || no < 1) {
    return out({ ok: false, error: "candidate_no 는 address_candidates 의 번호(no)입니다." }, true);
  }
  const selection: Record<string, unknown> = { candidateNo: no };
  if (typeof input?.address_detail === "string" && input.address_detail.trim()) {
    selection.addressDetail = input.address_detail.trim();
  }
  return await reReview(ctx, { action: "select_address", targetIndex: i, selection });
}

const PATCH_FIELDS: [input: string, api: string][] = [
  ["address", "address"],
  ["address_detail", "addressDetail"],
  ["recipient_name", "recipientName"],
  ["phone", "phone"],
  ["sender_name", "senderName"],
  ["sender_phone", "senderPhone"],
  ["depositor_name", "depositorName"],
  ["memo", "memo"],
  ["product_query", "productQuery"],
];

async function toolPatchOrder(ctx: Ctx, input: Json): Promise<ToolOut> {
  const bad = await needDraft(ctx);
  if (bad) return bad;
  const i = orderAt(ctx, input?.order_no);
  if (i < 0) return out({ ok: false, error: "order_no 는 검수 내용의 주문 번호(no)입니다." }, true);
  const patch: Record<string, unknown> = {};
  for (const [from, to] of PATCH_FIELDS) {
    if (typeof input?.[from] === "string") patch[to] = input[from];
  }
  if (input?.quantity !== undefined && input?.quantity !== null) patch.quantity = String(input.quantity);
  if (input?.product_no !== undefined && input?.product_no !== null) {
    const candidates: Json[] = ctx.draft!.orders[i]?.productCandidates ?? [];
    const picked = candidates[Number(input.product_no) - 1];
    if (!picked?.id) {
      return out({ ok: false, error: "product_no 는 그 주문의 product_candidates 번호(no)입니다." }, true);
    }
    patch.productId = picked.id;
    delete patch.productQuery;
  }
  if (!Object.keys(patch).length) return out({ ok: false, error: "고칠 칸을 하나 이상 넣으세요." }, true);
  return await reReview(ctx, { action: "patch_order", targetIndex: i, patch });
}

async function toolRemoveOrder(ctx: Ctx, input: Json): Promise<ToolOut> {
  const bad = await needDraft(ctx);
  if (bad) return bad;
  const i = orderAt(ctx, input?.order_no);
  if (i < 0) return out({ ok: false, error: "order_no 는 검수 내용의 주문 번호(no)입니다." }, true);
  const rest = ctx.draft!.orders.filter((_, idx) => idx !== i);
  if (!rest.length) {
    await dropDraft(ctx);
    return out({ ok: true, review: null, note: "남은 주문이 없어 검수를 끝냈습니다." });
  }
  return await reReview(ctx, { action: "recheck" }, rest);
}

async function toolRecheckOrders(ctx: Ctx): Promise<ToolOut> {
  const bad = await needDraft(ctx);
  if (bad) return bad;
  return await reReview(ctx, { action: "recheck" });
}

const IN_DOUBT_HELP =
  "중복 등록을 막기 위해 다시 보내지 않습니다. run_sql 로 방금 등록됐는지 확인하세요" +
  "(orders 에서 이 회원이 created_by 이고 created_at 이 방금인 주문). " +
  "등록됐으면 cancel_orders 로 검수를 끝내고 주문번호를 알려 주고, " +
  "안 됐으면 recheck_orders 로 다시 검수한 뒤 사용자에게 다시 확인받으세요.";

async function toolSaveOrders(ctx: Ctx): Promise<ToolOut> {
  const changed = await syncDraft(ctx);
  const d = ctx.draft;
  if (!d || !d.orders.length) {
    return out({ ok: false, code: "no_review", error: "진행 중인 주문 검수가 없습니다." }, true);
  }
  if (d.saving_at) {
    return out({ ok: false, code: "save_in_doubt",
      error: `이전 등록 요청의 결과를 확인하지 못한 상태입니다. ${IN_DOUBT_HELP}` }, true);
  }
  if (!allOk(d)) {
    return out({ ok: false, code: "needs_fix", error: "확인이 필요한 주문이 남아 있어 등록할 수 없습니다.",
      review: draftView(d) }, true);
  }
  // 사용자가 "전부 ok" 상태를 한 번 보고 답한 경우에만 등록한다.
  if (changed || !ctx.saveAllowed || ctx.draftChanged) {
    return out({ ok: false, code: "confirm_first",
      error: "사용자 확인 전에는 등록하지 않습니다. 등록할 내용을 보여 주고 등록할지 물은 뒤, " +
        "사용자가 그다음 메시지에서 동의하면 호출하세요.",
      review: draftView(d) }, true);
  }

  const markErr = await writeDraft(ctx, { ...d, saving_at: new Date().toISOString() });
  if (markErr) return out({ ok: false, error: markErr }, true);

  const r = await callRpc(ctx, "create-farm-orders", d.save_request, 60_000);
  if (r.ok) {
    const saved: Json[] = Array.isArray(r.data?.orders) ? r.data.orders : [];
    await dropDraft(ctx);
    ctx.meta.saved = saved.map((o) => ({ id: o?.id, order_no: o?.orderNo, total: o?.total }));
    return out(compact({ ok: true, farm: d.farm_name,
      saved: saved.map((o) => ({ order_no: o?.orderNo, total: o?.total })) }));
  }
  // 응답을 못 받았거나(0) 게이트웨이 오류면 들어갔는지 알 수 없다.
  if (r.status === 0 || r.status === 502 || r.status === 504) {
    return out({ ok: false, code: "save_in_doubt", status: r.status,
      error: `등록 요청의 결과를 확인하지 못했습니다. ${IN_DOUBT_HELP}` }, true);
  }
  // 서버가 거절했다. 전부 아니면 전무라 한 건도 들어가지 않았다.
  await writeDraft(ctx, { ...d, saving_at: null });
  return out({ ok: false, status: r.status, ...errBody(r), note: "한 건도 등록되지 않았습니다." }, true);
}

async function toolCancelOrders(ctx: Ctx): Promise<ToolOut> {
  await dropDraft(ctx);
  return out({ ok: true, note: "주문 검수를 버렸습니다." });
}

async function runOrderTool(ctx: Ctx, name: string, input: Json): Promise<ToolOut | null> {
  switch (name) {
    case "review_orders": return await toolReviewOrders(ctx, input);
    case "select_address": return await toolSelectAddress(ctx, input);
    case "patch_order": return await toolPatchOrder(ctx, input);
    case "remove_order": return await toolRemoveOrder(ctx, input);
    case "recheck_orders": return await toolRecheckOrders(ctx);
    case "save_orders": return await toolSaveOrders(ctx);
    case "cancel_orders": return await toolCancelOrders(ctx);
    default: return null;
  }
}

// 고객 정보(system 두 번째 블록)에 붙이는 현재 검수 상태.
function draftContext(ctx: Ctx): string {
  const d = ctx.draft;
  if (!d) return "";
  const lines = ["", "진행 중인 주문 검수 (등록 전, 서버 보관)", JSON.stringify(draftView(d))];
  if (d.orders.length) {
    lines.push(ctx.saveAllowed
      ? "- 전부 확인된 상태다. 사용자가 이번 메시지에서 등록에 동의했으면 save_orders 를 부른다."
      : "- 아직 등록할 수 없다(확인이 필요한 주문이 있거나 결과 확인이 필요함).");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Claude

// 처음 뜰 때 SDK 로딩이 2초쯤 걸려 카카오 5초 제한을 위협한다.
// 그래서 useCallback 응답을 먼저 보내고, 뒤에서 처음 쓸 때 불러온다.
let client: Anthropic | null = null;
async function claude(): Promise<Anthropic> {
  if (!client) {
    const { default: AnthropicSdk } = await import("npm:@anthropic-ai/sdk@1.12.0");
    client = new AnthropicSdk({ apiKey: env("ANTHROPIC_API_KEY") });
  }
  return client;
}

const INSTRUCTIONS = `너는 팜어시(농가 직거래 쇼핑몰) 카카오톡 채널의 상담 챗봇이다.

답변 형식
- 카카오톡 말풍선으로 나간다. 마크다운(**, #, 표, 코드블록)을 쓰지 말고 일반 문장으로 쓴다.
- 짧게. 보통 2~5문장, 길어도 400자 안쪽. 존댓말.
- 날짜·시각은 한국 시간으로, "11월 25일(화) 오후 2시"처럼 사람이 읽기 쉽게.

조회
- 주문·배송·상품·농가처럼 데이터가 필요한 질문은 run_sql 도구로 운영 DB(PostgreSQL)를 조회한 뒤 답한다.
  추측해서 답하지 않는다.
- SELECT 한 문장씩. 필요한 컬럼만 고르고 limit 을 건다. 고객이 준 값은 $1 자리표시자와 params 로 넘긴다.
- 오류가 오면 메시지를 보고 SQL 을 고쳐 다시 시도한다. 그래도 안 되면 확인 후 안내하겠다고 답한다.
- 아래 스키마에 없는 테이블·컬럼을 지어내지 않는다.

이전 대화
- 메시지에는 직전 한 번의 대화(고객 질문과 그에 대한 답)만 들어 있다.
- "아까 그거", "전에 말한 주문"처럼 그보다 앞의 맥락이 필요할 때만 get_history 로 더 읽는다.
  필요 없으면 부르지 않는다.

고객
- 대화 상대는 아래 "고객 정보"의 사람이다. 주문·배송 조회는 그 사람의 user_id 기준으로 한다.
- 다른 고객의 이름·연락처·주소·주문 내용은 알려주지 않는다.
- 회원 매칭이 안 된 고객이 본인 주문을 물으면, 팜어시에 카카오로 로그인한 계정으로 문의해 달라고 안내한다.
- 환불·교환·주소 변경처럼 처리가 필요한 요청은 접수 내용을 정리해 주고 담당자가 확인 후 연락드린다고 안내한다.
  챗봇이 직접 처리했다고 말하지 않는다.

주문 등록 (농가 회원용)
- 농가 회원이 손님에게 받은 주문 내용(받는 분, 연락처, 주소, 상품 등)을 보내면 review_orders 로 검수한다.
  원문은 고치거나 요약하지 않는다(source=current_message 면 방금 메시지가 그대로 넘어간다).
- 검수 내용은 서버가 보관한다. 고객 정보 아래 "진행 중인 주문 검수"에 현재 상태가 나오고, 도구 응답의 review 도 같은 형식이다.
- 확인이 필요한 주문(status 가 ok 가 아님)이 있으면 번호가 앞선 것부터 하나씩 묻는다.
  needs_address_select: address_candidates 를 번호와 함께 보여 주고 고르게 한다. 후보가 1건이어도 사용자가 확인하기 전에는 고르지 않는다.
  needs_address_fix: errors 를 보고 동·호만 받을지 주소 전체를 다시 받을지 정한다.
  needs_product_select: product_candidates 를 번호, 가격과 함께 보여 주고 고르게 한다.
  needs_field_fix: errors 에 나온 칸만 다시 받는다.
- 사용자의 답은 select_address, patch_order 로 반영한다. 사용자가 말하지 않은 값을 추측해서 채우지 않는다.
- 전부 ok 가 되면 농가 이름과 주문별 받는 분, 주소, 상품, 수량, 금액을 보여 주고 등록할지 묻는다.
  메시지에 적힌 상품 문구(product_in_message)와 매칭된 상품이 다르게 보이면 그 점도 짚는다. 이 답에서는 save_orders 를 부르지 않는다.
- 사용자가 그다음 메시지에서 등록에 동의하면 save_orders 를 부르고, 응답의 주문번호와 금액을 알려 준다.
  도구가 성공하지 않았으면 등록됐다고 말하지 않는다.
- 검수 중에 주문 원문이 더 오면 이어서 보낸 것인지(append) 새로 시작하는 것인지 문맥으로 판단하고, 애매하면 묻는다.
- 그만두겠다고 하면 cancel_orders, 특정 주문만 빼 달라고 하면 remove_order.
- 오류 code 가 not_linked, no_kakao_id 면 팜어시에 카카오로 로그인한 농가 계정만 쓸 수 있는 기능이라고 안내한다.
  farm_required 면 farms 를 보여 주고 어느 농가인지 물은 뒤 review_orders(source=pending, farm_id)로 다시 검수한다.
  no_farm 은 연결된 농가가 없다는 뜻이다. 사용자가 관리자라서 농가를 지정하면 run_sql 로 농가 id 를 찾아 같은 방식으로 다시 검수한다.
- 주문 검수 내용을 보여 줄 때는 400자를 넘겨도 된다(말풍선 3개, 각 1000자까지 나뉘어 나간다).`;

const RUN_SQL_TOOL = {
  name: "run_sql",
  description:
    "팜어시 운영 PostgreSQL 에서 읽기 전용 SQL 한 문장을 실행한다. 결과는 {columns, rows, row_count, truncated} " +
    "JSON 이며 최대 200행, 5초 제한. 쓰기·여러 문장은 거부된다. 시각은 Asia/Seoul. " +
    "$1, $2 자리표시자를 쓰면 params 에 값을 넣고, 타입은 SQL 에서 캐스팅한다(예: $1::uuid).",
  input_schema: {
    type: "object" as const,
    properties: {
      sql: { type: "string", description: "실행할 SELECT 문 한 개" },
      params: {
        type: "array",
        description: "$1, $2 … 에 들어갈 값",
        items: { type: ["string", "number", "boolean", "null"] },
      },
    },
    required: ["sql"],
    additionalProperties: false,
  },
};

const GET_HISTORY_TOOL = {
  name: "get_history",
  description:
    "이 고객과의 이전 카카오톡 대화를 지금 보이는 것보다 더 앞에서부터 읽는다. 최근 것부터 거꾸로 limit 건. " +
    "다시 부르면 그보다 더 앞의 대화를 준다. 더 없으면 빈 결과.",
  input_schema: {
    type: "object" as const,
    properties: {
      limit: { type: "integer", description: `읽을 메시지 수 (1~${HISTORY_PAGE_MAX})` },
    },
    required: ["limit"],
    additionalProperties: false,
  },
};

const NO_INPUT = { type: "object" as const, properties: {}, additionalProperties: false };

const ORDER_TOOLS = [
  {
    name: "review_orders",
    description:
      "농가 회원이 보낸 주문 원문을 검수한다(파싱, 상품 매칭, 우체국 주소 확정, 동·호, 필수값). 등록은 하지 않는다. " +
      "결과는 서버가 보관하고 review 로 돌려준다. 원문 파싱에 수십 초 걸릴 수 있다. " +
      "source: current_message=사용자가 방금 보낸 메시지 그대로(보통 이것), " +
      "pending=농가를 정하지 못해 보관해 둔 원문, text=여러 메시지에 나뉜 원문을 합쳐서 직접 넘길 때. " +
      "append=true 면 진행 중인 검수에 주문을 더하고, 아니면 새로 시작한다(기존 검수는 버려진다).",
    input_schema: {
      type: "object" as const,
      properties: {
        source: { type: "string", enum: ["current_message", "pending", "text"] },
        text: { type: "string", description: "source=text 일 때만. 주문 원문 그대로" },
        farm_id: { type: "string", description: "농가 id(uuid). 회원의 농가가 하나뿐이면 생략" },
        append: { type: "boolean" },
      },
      required: ["source"],
      additionalProperties: false,
    },
  },
  {
    name: "select_address",
    description:
      "검수 중인 주문 하나에 사용자가 고른 주소 후보를 넣고 다시 검수한다. 사용자가 고르거나 확인한 뒤에만 부른다.",
    input_schema: {
      type: "object" as const,
      properties: {
        order_no: { type: "integer", description: "주문 번호(no)" },
        candidate_no: { type: "integer", description: "그 주문 address_candidates 의 번호(no)" },
        address_detail: { type: "string", description: "사용자가 동·호를 같이 말했을 때만" },
      },
      required: ["order_no", "candidate_no"],
      additionalProperties: false,
    },
  },
  {
    name: "patch_order",
    description:
      "검수 중인 주문 하나의 칸을 사용자가 말한 값으로 고치고 다시 검수한다. 고칠 칸만 넣는다. " +
      "address 는 새 주소 전체(우체국부터 다시 찾는다), address_detail 은 동·호만. " +
      "상품은 product_no(product_candidates 번호)로 고르거나 product_query(상품 문구)로 다시 매칭한다.",
    input_schema: {
      type: "object" as const,
      properties: {
        order_no: { type: "integer", description: "주문 번호(no)" },
        address: { type: "string" },
        address_detail: { type: "string" },
        recipient_name: { type: "string" },
        phone: { type: "string" },
        sender_name: { type: "string" },
        sender_phone: { type: "string" },
        depositor_name: { type: "string" },
        memo: { type: "string" },
        product_no: { type: "integer" },
        product_query: { type: "string" },
        quantity: { type: "integer" },
      },
      required: ["order_no"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_order",
    description: "검수 중인 주문 하나를 뺀다. 사용자가 빼 달라고 했을 때만.",
    input_schema: {
      type: "object" as const,
      properties: { order_no: { type: "integer", description: "주문 번호(no)" } },
      required: ["order_no"],
      additionalProperties: false,
    },
  },
  {
    name: "recheck_orders",
    description: "진행 중인 검수 전체를 지금 기준으로 다시 검수한다.",
    input_schema: NO_INPUT,
  },
  {
    name: "save_orders",
    description:
      "검수가 전부 ok 인 주문을 실제로 등록한다. 등록할 내용을 보여 주고 물은 뒤, " +
      "사용자가 그다음 메시지에서 동의했을 때만 부른다. 검수와 등록을 같은 답 안에서 함께 하지 않는다.",
    input_schema: NO_INPUT,
  },
  {
    name: "cancel_orders",
    description: "진행 중인 주문 검수를 버린다. 사용자가 그만두겠다고 했을 때.",
    input_schema: NO_INPUT,
  },
];

// 도구 순서는 고정(캐시가 접두사 일치라 순서가 바뀌면 캐시가 깨진다).
const TOOLS = [RUN_SQL_TOOL, GET_HISTORY_TOOL, ...ORDER_TOOLS];

async function getHistoryPage(ctx: Ctx, limit: number): Promise<string> {
  if (!ctx.kakaoUserId || !ctx.historyBeforeId) return "(더 이전 대화 없음)";
  const n = Math.max(1, Math.min(HISTORY_PAGE_MAX, Math.floor(limit) || 10));
  const { data, error } = await ctx.db
    .from("kakao_messages")
    .select("id, direction, text, created_at")
    .eq("kakao_user_id", ctx.kakaoUserId)
    .lt("id", ctx.historyBeforeId)
    .order("id", { ascending: false })
    .limit(n);
  if (error) return `(대화 기록을 읽지 못함: ${error.message})`;
  if (!data || data.length === 0) return "(더 이전 대화 없음)";
  ctx.historyBeforeId = data[data.length - 1].id;   // 다음 호출은 그보다 앞에서
  return data.reverse()
    .filter((row) => row.text)
    .map((row) => {
      const at = new Date(row.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
      return `[${at}] ${row.direction === "in" ? "고객" : "봇"}: ${row.text}`;
    })
    .join("\n");
}

function customerContext(ctx: Ctx, member: Member | null | "error"): string {
  const lines = ["고객 정보"];
  if (member === "error") {
    lines.push("- 회원 조회 실패(DB 연결 문제). 주문 조회가 어려우면 확인 후 안내하겠다고 답한다.");
  } else if (member) {
    lines.push(`- 팜어시 회원 user_id: ${member.user_id}`);
    if (member.display_name) lines.push(`- 이름(표시명): ${member.display_name}`);
    if (member.role) lines.push(`- 역할: ${member.role}`);
  } else if (ctx.appUserId) {
    lines.push("- 팜어시 회원과 매칭되지 않음(카카오 로그인 기록 없음).");
  } else {
    lines.push("- 카카오 회원번호를 받지 못함. 회원 여부를 알 수 없음.");
  }
  lines.push(`- 지금 시각: ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
  return lines.join("\n") + draftContext(ctx);
}

// 처음엔 직전 한 번의 대화만. 그보다 앞은 get_history 로 필요할 때만 읽는다.
async function loadHistory(ctx: Ctx): Promise<Anthropic.Beta.Messages.BetaMessageParam[]> {
  ctx.historyBeforeId = ctx.inMessageId;
  if (!ctx.kakaoUserId || !ctx.inMessageId) return [];
  const { data, error } = await ctx.db
    .from("kakao_messages")
    .select("id, direction, text")
    .eq("kakao_user_id", ctx.kakaoUserId)
    .lt("id", ctx.inMessageId)
    .order("id", { ascending: false })
    .limit(HISTORY_ROWS);
  if (error || !data) return [];
  if (data.length) ctx.historyBeforeId = data[data.length - 1].id;

  // 오래된 것부터, user/assistant 가 번갈아 오도록 같은 역할은 합친다.
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const row of data.reverse()) {
    if (!row.text) continue;
    const role = row.direction === "in" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n" + row.text;
    else out.push({ role, content: row.text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

// 콜백·동기 양쪽에서 쓰는 답장 생성.
async function buildReply(ctx: Ctx): Promise<SkillResponse> {
  const started = Date.now();
  // 봇테스트처럼 appUserId 가 빠진 요청이면, 같은 사용자에게 전에 받아 둔 값을 쓴다.
  if (!ctx.appUserId && ctx.kakaoUserId) {
    const { data } = await ctx.db.from("kakao_users").select("app_user_id")
      .eq("id", ctx.kakaoUserId).maybeSingle();
    ctx.appUserId = data?.app_user_id ?? null;
  }
  const [schema, member, history, draft] = await Promise.all([
    loadSchema(), findMember(ctx.appUserId), loadHistory(ctx), readDraft(ctx),
  ]);
  ctx.memberUserId = member && member !== "error" ? member.user_id : null;
  ctx.draft = draft;
  ctx.draftRev = draft?.rev ?? 0;
  ctx.saveAllowed = allOk(draft) && !draft?.saving_at;
  if (member && member !== "error" && ctx.kakaoUserId) {
    await ctx.db.from("kakao_users").update({ member_id: member.user_id }).eq("id", ctx.kakaoUserId);
  }

  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [...history];
  const last = messages[messages.length - 1];
  if (last && last.role === "user") last.content = `${last.content}\n${ctx.utterance}`;
  else messages.push({ role: "user", content: ctx.utterance });

  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [
    // 고정 부분(지침+스키마)을 앞에 두고 캐시한다. 고객별로 바뀌는 내용은 그 뒤에.
    { type: "text", text: `${INSTRUCTIONS}\n\nDB 스키마 (schema.table: column type, …)\n${schema}`,
      cache_control: { type: "ephemeral" } },
    { type: "text", text: customerContext(ctx, member) },
  ];

  const sqlLog: { sql: string; status: number; ok: boolean }[] = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const historyCalls: number[] = [];
  const orderTools: string[] = [];
  ctx.meta = { model: MODEL, member: member === "error" ? "error" : member?.user_id ?? null,
    sql: sqlLog, history_calls: historyCalls, order_tools: orderTools, rpc: ctx.rpcLog, usage };

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    if (Date.now() - started > DEADLINE_MS) break;
    const resp = await (await claude()).beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",               // 안전 분류기가 거절하면 서버가 다른 모델로 이어서 답함
      output_config: { effort: "medium" },
      // 대화 캐시: 마지막 블록에 자동으로 캐시 지점을 둔다. 한 질문에 Claude 를 여러 번 부를 때
      // 앞선 대화·조회 결과를 두 번째 호출부터 캐시 가격으로 읽는다. (system 앞부분 캐시와 별개)
      cache_control: { type: "ephemeral" },
      system,
      tools: TOOLS,
      messages,
    }, { timeout: 60_000 });

    usage.input_tokens += resp.usage.input_tokens ?? 0;
    usage.output_tokens += resp.usage.output_tokens ?? 0;
    usage.cache_read_input_tokens += resp.usage.cache_read_input_tokens ?? 0;
    usage.cache_creation_input_tokens += resp.usage.cache_creation_input_tokens ?? 0;
    ctx.meta.rounds = round;
    ctx.meta.served_by = resp.model;
    ctx.meta.stop_reason = resp.stop_reason;

    if (resp.stop_reason === "refusal") {
      return simpleText("그 내용은 제가 답하기 어려워요. 담당자가 확인 후 안내드릴게요.");
    }

    if (resp.stop_reason === "tool_use" || resp.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: resp.content });
      if (resp.stop_reason === "pause_turn") continue;

      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== "tool_use") continue;
        // deno-lint-ignore no-explicit-any
        const input = block.input as any;
        if (block.name === "get_history") {
          const limit = Number(input?.limit) || 10;
          historyCalls.push(limit);
          results.push({ type: "tool_result", tool_use_id: block.id, content: await getHistoryPage(ctx, limit) });
          continue;
        }
        if (block.name !== "run_sql") {
          let res: ToolOut | null;
          try {
            res = await runOrderTool(ctx, block.name, input);
          } catch (e) {
            console.error("order tool failed", block.name, e);
            res = out({ ok: false, error: `도구 실행 중 오류: ${e}` }, true);
          }
          if (res) orderTools.push(block.name);
          else res = [`알 수 없는 도구: ${block.name}`, true];
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: res[1], content: res[0] });
          continue;
        }
        if (typeof input?.sql !== "string") {
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true,
            content: "run_sql 에 sql(문자열)을 넣어 다시 호출하세요." });
          continue;
        }
        const params = Array.isArray(input.params) ? input.params : [];
        const r = await runSql(input.sql, params);
        sqlLog.push({ sql: input.sql.slice(0, 2000), status: r.status, ok: r.ok });
        results.push({ type: "tool_result", tool_use_id: block.id, is_error: !r.ok, content: r.body });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // end_turn / max_tokens / stop_sequence
    const text = resp.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return simpleText(text || ERROR_TEXT);
  }
  return simpleText(BUSY_TEXT);
}

// ---------------------------------------------------------------------------
// 저장

async function logOut(
  ctx: Ctx,
  res: SkillResponse,
  via: "sync" | "callback",
  startedAt: number,
  error: string | null,
  extra?: unknown,
) {
  const { error: dbErr } = await ctx.db.from("kakao_messages").insert({
    kakao_user_id: ctx.kakaoUserId,
    direction: "out",
    text: replyText(res),
    via,
    latency_ms: Date.now() - startedAt,
    error,
    raw: { response: res, callback: extra ?? null, claude: ctx.meta },
  });
  if (dbErr) console.error("log out failed", dbErr);
}

// ---------------------------------------------------------------------------
// 요청 처리

// 카카오는 Supabase 키를 보낼 수 없으므로 auth: "none" + 플랫폼 JWT 검증 끔.
// 대신 아래 x-skill-token 헤더로 막습니다.
async function handle(req: Request, db: SupabaseClient): Promise<Response> {
  if (req.method !== "POST") return new Response("ok");
  const expected = env("KAKAO_SKILL_TOKEN");
  if (!expected || (req.headers.get("x-skill-token") ?? "").trim() !== expected) {
    return new Response("unauthorized", { status: 401 });
  }

  const startedAt = Date.now();
  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(simpleText(ERROR_TEXT));
  }

  const ur = body?.userRequest ?? {};
  const user = ur.user ?? {};
  const props = user.properties ?? {};
  const ctx: Ctx = {
    db,
    kakaoUserId: null,
    inMessageId: null,
    appUserId: props.appUserId != null ? String(props.appUserId) : null,
    utterance: String(ur.utterance ?? ""),
    meta: {},
    historyBeforeId: null,
    memberUserId: null,
    draft: null,
    draftRev: 0,
    saveAllowed: false,
    draftChanged: false,
    rpcLog: [],
  };

  // 사용자 저장 + 받은 메시지 저장 (실패해도 답장은 보냄)
  const logIn = async () => {
    try {
      const { data, error } = await db.rpc("kakao_touch_user", {
        p_bot_user_key: String(user.id ?? props.botUserKey ?? "unknown"),
        p_plusfriend_user_key: props.plusfriendUserKey ?? null,
        p_app_user_id: ctx.appUserId,
        p_is_friend: props.isFriend === true,
      });
      if (error) throw error;
      ctx.kakaoUserId = data as string;

      const { data: inRow, error: inErr } = await db.from("kakao_messages").insert({
        kakao_user_id: ctx.kakaoUserId,
        direction: "in",
        text: ctx.utterance,
        block_id: ur.block?.id ?? null,
        block_name: ur.block?.name ?? null,
        raw: body,
      }).select("id").single();
      if (inErr) throw inErr;
      ctx.inMessageId = inRow?.id ?? null;
    } catch (e) {
      console.error("log in failed", e);
    }
  };

  const reply = async (): Promise<[SkillResponse, string | null]> => {
    try {
      return [await buildReply(ctx), null];
    } catch (e) {
      console.error("buildReply failed", e);
      return [simpleText(ERROR_TEXT), `buildReply: ${e}`];
    }
  };

  const callbackUrl: string | undefined = ur.callbackUrl;

  if (callbackUrl) {
    // 5초 제한 때문에 먼저 응답하고, 저장·답장은 뒤에서 처리
    EdgeRuntime.waitUntil((async () => {
      await logIn();
      const [res, buildErr] = await reply();
      let err = buildErr;
      let cbResult: unknown = null;
      try {
        const r = await fetch(callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(res),
        });
        cbResult = await r.json().catch(() => null);
        // deno-lint-ignore no-explicit-any
        const status = (cbResult as any)?.status;
        if (!r.ok || (status && status !== "SUCCESS")) {
          err = [err, `callback ${r.status} ${JSON.stringify(cbResult)}`].filter(Boolean).join(" | ");
        }
      } catch (e) {
        err = [err, `callback fetch: ${e}`].filter(Boolean).join(" | ");
      }
      await logOut(ctx, res, "callback", startedAt, err, cbResult);
    })());
    return json({ version: "2.0", useCallback: true, data: { text: WAIT_TEXT } });
  }

  // 콜백 없는 요청(스킬 테스트 등). Claude 를 부르면 5초를 넘기기 쉬워 안내 문구만 돌려준다.
  await logIn();
  const res = simpleText("콜백이 켜진 블록에서만 답변할 수 있어요.");
  EdgeRuntime.waitUntil(logOut(ctx, res, "sync", startedAt, null));
  return json(res);
}

export default {
  fetch: withSupabase({ auth: "none", cors: "disabled" }, (req, sb) => handle(req, sb.supabaseAdmin)),
};
