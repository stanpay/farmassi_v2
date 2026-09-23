"""
farmassi API (FastAPI).

Node 서버(server/)를 옮기는 중이다. 두 서버가 동시에 떠 있어도 되도록
경로별로 nginx 에서 넘긴다. 응답 형태는 Node 쪽과 같아야 한다 —
프론트가 그 형태에 맞춰져 있고 거슬러 올라가면 PostgREST 형식이다.
"""
import json
import os
from contextlib import asynccontextmanager

import base64

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db
from .config import config
from .jwt_session import sign, verify
from .functions import FUNCTIONS, FnCtx
from .kakao import callback_url, start_url
from .query import run_query
from .scheduler import start_scheduler
from .storage import delete_image, resolve_file, upload_image
from .version import VERSION


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.connect()
    print(f"farmassi API (py) v{VERSION['version']} ({VERSION['commit']}) → http://127.0.0.1:{config.port}")
    task = start_scheduler()
    yield
    if task is not None:
        task.cancel()
    await db.disconnect()


app = FastAPI(lifespan=lifespan, docs_url="/docs", redoc_url=None)


@app.middleware("http")
async def cors(request: Request, call_next):
    """
    Node 의 cors() 와 같게 동작시킨다.

    브라우저가 자격증명을 보내야 하므로 * 를 쓸 수 없다. 허용한 출처만
    그대로 돌려준다. FastAPI 의 CORSMiddleware 를 쓰지 않은 이유는
    허용되지 않은 출처에도 헤더를 붙이는 등 세부가 달라서다.
    """
    origin = request.headers.get("origin")
    if request.method == "OPTIONS":
        # 204 는 본문이 없어야 한다. JSONResponse(None) 은 "null" 4바이트를 실어서
        # uvicorn 이 사전 요청마다 "Response content longer than Content-Length" 를 냈다.
        response = Response(status_code=204)
    else:
        response = await call_next(request)

    if origin and (origin in config.site_origins or origin.startswith("http://localhost")):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"] = "authorization, content-type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    return response


def user_id(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.startswith("Bearer "):
        return None
    claims = verify(header[7:])
    return claims["sub"] if claims else None


@app.exception_handler(StarletteHTTPException)
async def on_http_error(_: Request, exc: StarletteHTTPException):
    """맞는 경로가 없으면 Node 와 같은 본문을 낸다. 프론트가 문구로 분기하지는
    않지만, 대조로 차이를 잡아내려면 형태가 같아야 한다."""
    if exc.status_code == 404:
        return JSONResponse({"error": "없는 주소입니다."}, status_code=404)
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.exception_handler(Exception)
async def on_error(_: Request, exc: Exception):
    """Node 쪽과 같이 처리 실패는 400 에 { error } 로 낸다."""
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/version")
async def version():
    """화면에서 지금 돌고 있는 서버가 무엇인지 보여주기 위한 것."""
    return VERSION


@app.get("/auth/me")
async def auth_me(uid: str | None = Depends(user_id)):
    if not uid:
        return {"user": None}
    async with db.with_user(uid) as conn:
        row = await conn.fetchrow("select * from profiles where id = $1", uid)
    return {"user": {"id": uid, "profile": dict(row)} if row else None}


@app.post("/query")
async def query(request: Request, uid: str | None = Depends(user_id)):
    """데이터 게이트웨이. RLS 가 적용되는 커넥션으로 나간다."""
    body = await request.json()
    async with db.with_user(uid) as conn:
        result = await run_query(conn, body)
    return {"data": result.data, "count": result.count, "error": None}


@app.post("/rpc/{name}")
async def rpc(name: str, request: Request, uid: str | None = Depends(user_id)):
    """Edge Function 대체. 이름은 그대로 유지한다."""
    handler = FUNCTIONS.get(name)
    if handler is None:
        return JSONResponse({"error": f"없는 함수: {name}"}, status_code=404)

    body = await request.json() if await request.body() else {}
    # 크론은 시크릿 헤더로 들어온다. 로그인 없이 실행할 수 있는 유일한 경로.
    cron_secret = os.environ.get("CRON_SECRET")
    if cron_secret and request.headers.get("x-cron-secret") == cron_secret:
        body["__byCron"] = True

    async with db.with_admin() as conn:
        result = await handler(FnCtx(user_id=uid, body=body, admin=conn))
    return JSONResponse(result.body, status_code=result.status)


# 업로드는 base64 로 33% 부풀기 때문에 일반 요청보다 크게 받는다.
MAX_BODY = 2 * 1024 * 1024
MAX_UPLOAD_BODY = 9 * 1024 * 1024   # 5MB 원본 + base64 여유


@app.get("/files/{path:path}")
async def files(path: str):
    """업로드된 파일을 공개로 내보낸다. nginx 를 거치지 않는 경로에서도 동작하도록."""
    try:
        found = resolve_file(path)
    except Exception:  # noqa: BLE001
        return JSONResponse(None, status_code=400)
    if found is None:
        return JSONResponse({"error": "파일을 찾을 수 없습니다."}, status_code=404)
    full, mime = found
    return FileResponse(full, media_type=mime,
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.post("/storage/upload")
async def storage_upload(request: Request, uid: str | None = Depends(user_id)):
    raw = await request.body()
    if len(raw) > MAX_UPLOAD_BODY:
        raise Exception(f"요청 본문이 너무 큽니다. (최대 {MAX_UPLOAD_BODY // 1024 // 1024}MB)")
    body = json.loads(raw) if raw else {}
    data = base64.b64decode(str(body.get("data") or ""), validate=False)
    async with db.with_user(uid) as conn:
        return await upload_image(conn, uid, str(body.get("path") or ""),
                                  str(body.get("contentType") or ""), data)


@app.post("/storage/delete")
async def storage_delete(request: Request, uid: str | None = Depends(user_id)):
    body = await request.json() if await request.body() else {}
    async with db.with_user(uid) as conn:
        await delete_image(conn, uid, str(body.get("path") or ""))
    return {"ok": True}


@app.get("/auth/kakao/start")
async def kakao_start(redirect: str | None = None):
    return RedirectResponse(start_url(redirect), status_code=302)


@app.get("/auth/kakao/callback")
async def kakao_callback(code: str | None = None, state: str | None = None):
    return RedirectResponse(await callback_url(code, state), status_code=302)


@app.post("/auth/dev-login")
async def dev_login(request: Request):
    """카카오 로그인이 붙기 전까지 쓰는 임시 발급구. ALLOW_DEV_LOGIN 이 켜져 있을 때만."""
    if os.environ.get("ALLOW_DEV_LOGIN") != "true":
        return JSONResponse({"error": "사용할 수 없습니다."}, status_code=404)
    body = await request.json() if await request.body() else {}
    email = str(body.get("email") or "").strip()
    if not email:
        return JSONResponse({"error": "email 이 필요합니다."}, status_code=400)

    async with db.with_admin() as conn:
        found = await conn.fetchval("select id from auth.users where email = $1", email)
        if found:
            uid = found
        else:
            uid = await conn.fetchval(
                "insert into auth.users (email, raw_user_meta_data)"
                " values ($1, $2) returning id",
                email, json.dumps({"nickname": body.get("name") or email.split("@")[0]}))
    return {"token": sign(uid), "userId": uid}
