// 카카오 챗봇 스킬 서버 (Supabase Edge Function)
// - 요청 헤더 x-skill-token 으로 카카오 스킬 요청만 받습니다.
// - 사용자(botUserKey, plusfriendUserKey, appUserId)와 모든 대화를 저장합니다.
// - 콜백이 켜진 블록이면 바로 useCallback 으로 답하고, 실제 답은 callbackUrl 로 보냅니다.
// - 답은 Claude 가 만듭니다. 운영 DB 는 api.shop.lkim.me/chatbot/query(읽기 전용)로 조회합니다.
//   명세: doc/kakao-chatbot/developer-handoff.md
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
const MAX_TOOL_ROUNDS = 6;          // Claude ↔ 도구 왕복 최대 횟수
const DEADLINE_MS = 110_000;        // Edge Function 실행 한도(무료 150초) 안에서 끝내기
const HISTORY_ROWS = 2;             // 처음엔 직전 한 번의 대화(고객 질문 + 봇 답)만 넘김. 더는 get_history 로
const HISTORY_PAGE_MAX = 20;        // get_history 한 번에 최대 몇 건
const KAKAO_TEXT_LIMIT = 1000;      // simpleText 최대 글자 수

// 요청마다 읽음(시크릿 변경 즉시 반영). 붙여넣기로 딸려 온 줄바꿈은 무시.
const env = (name: string) => (Deno.env.get(name) ?? "").trim();
const queryUrl = () => env("CHATBOT_QUERY_URL") || "https://api.shop.lkim.me/chatbot/query";

type SkillResponse = Record<string, unknown>;

function simpleText(text: string): SkillResponse {
  const t = text.length > KAKAO_TEXT_LIMIT ? text.slice(0, KAKAO_TEXT_LIMIT - 1) + "…" : text;
  return { version: "2.0", template: { outputs: [{ simpleText: { text: t } }] } };
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
  챗봇이 직접 처리했다고 말하지 않는다.`;

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

// 도구 순서는 고정(캐시가 접두사 일치라 순서가 바뀌면 캐시가 깨진다).
const TOOLS = [RUN_SQL_TOOL, GET_HISTORY_TOOL];

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
  return lines.join("\n");
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
  const [schema, member, history] = await Promise.all([
    loadSchema(), findMember(ctx.appUserId), loadHistory(ctx),
  ]);
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
  ctx.meta = { model: MODEL, member: member === "error" ? "error" : member?.user_id ?? null,
    sql: sqlLog, history_calls: historyCalls, usage };

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
        if (block.name !== "run_sql" || typeof input?.sql !== "string") {
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
