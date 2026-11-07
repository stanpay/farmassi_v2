# farmassi 문서

팜어시(farmassi)는 농가에서 바로 사는 산지직송 서비스다. 결제는 **무통장입금**이고
발송은 **우체국 창구소포**다. 이 두 가지가 구조 대부분을 설명한다 — PG 사가 없어
입금을 직접 읽어 주문과 맞추고, 접수를 사람이 하기 때문에 17시 마감과 배송 가능
요일이라는 제약이 생긴다.

> **[사고 기록](사고기록.md)** — 여기서 낸 사고와 원인, 작업 전 점검표.
> 작업을 시작하기 전에 읽는다.

## 어디를 보면 되나

| 디렉터리 | 내용 |
|---|---|
| [page/](page/) | 페이지. 경로 하나에 문서 하나 |
| [ui/](ui/) | 화면. 페이지 하나에 문서 하나 |
| [backend/](backend/) | API. 도메인별로 나누고 그 아래 `read`(조회)와 `command`(변경) |
| [database/](database/) | 테이블. 표 하나에 문서 하나 |

## 구성

```
브라우저 ──► Vercel (정적 호스팅)
              │
              └─► FastAPI (이 맥, uvicorn)  ──► PostgreSQL (이 맥)
                        │
                        ├─► 카카오 (로그인·지도·주소)
                        ├─► 뱅크다A (입금내역)
                        └─► 공공데이터포털 (공휴일)
```

- 프런트: React + Vite + Tailwind, `src/`
- 백엔드: FastAPI + asyncpg, `server-py/`. Node 서버에서 옮겨 왔고 지금은 파이썬만 쓴다
- DB: PostgreSQL. 권한은 **RLS** 로 건다. 어느 화면에서 불러도 같은 규칙이 적용된다

## 배포

| 브랜치 | 배포처 |
|---|---|
| `main` | farmassi.kr (운영) |
| `develop` | dev.farmassi.kr (개발) |

작업은 `ui`(화면)와 `ehyun`(서버·DB)에서 하고 `develop` 으로 머지한다.
dev 에서 확인한 뒤에 `main` 으로 올린다.

## 백업

매일 04:30 에 DB 전체와 `.env` 3개를 `~/FetchAccount/db-backups/` 에 받는다.
DB 를 건드리는 작업 전에는 [`server/db/snapshot.sh`](../server/db/snapshot.sh) 로 따로 스냅샷을 뜬다.
되돌릴 때는 [`server/db/restore.sh`](../server/db/restore.sh).
