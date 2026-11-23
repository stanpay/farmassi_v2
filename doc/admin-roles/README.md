# 관리자 권한 분리 (슈퍼어드민 / 일반 어드민)

기획: [../기획-농가-다중계정연결-및-관리자권한.md](../기획-농가-다중계정연결-및-관리자권한.md)

## 결정 (2026-11-23)

| 항목 | 결정 |
|---|---|
| 역할 | `profiles.role` = `customer` \| `super_admin`. 옛 `admin` 은 없앴다 (SQL 11) |
| 일반 어드민 | 역할이 아니라 **농가 연결(`farm_members`)** 로 정한다. role 은 `customer` 그대로 → 고객 기능과 자연히 같이 쓴다 |
| 연결 해제 | 연결이 없어지면 관리 화면 접근이 끊긴다. role 을 바꿀 일이 없다 |
| 일반 어드민 농가 수 | 1곳. DB 트리거로 막는다 (SQL 07). 슈퍼는 제한 없음 |
| 대표(`owner_user_id`) | 표시용. 권한 근거 아님. 대표를 해제하면 남은 사람 중 먼저 연결된 사람이 대표 (SQL 09) |
| 슈퍼어드민 | 현행 admin 3명 + 박지훈 010-8113-5708 계정 (SQL 03) |
| 일반 어드민이 쓰는 기능 | 농가 페이지(`/admin/farms/:id`)에 있는 것 전부 — 송장·배송이력 포함 (박지훈, 11/23). 출고기록 두 테이블을 멤버에게 연다 (SQL 05·06) |

판단은 한 곳씩: DB `private.is_admin()`, 서버 `util.ADMIN_ROLES`/`is_admin`, 화면 `lib/roles.ts isSuperAdminRole`.

## 운영 적용 순서

개발 DB(`farmassi_dev`)는 11/23 에 01~11 모두 적용했다.

1. 백업: `pg_dump -Fc farmassi`
2. SQL `01` ~ `10` 을 차례로 (DB 소유자 계정으로)
   ```
   for f in doc/admin-roles/sql/{01..10}-*.sql; do psql -d farmassi -v ON_ERROR_STOP=1 -f "$f" || break; done
   ```
3. **바로** 앱 배포 (main 머지 → Vercel, 운영 API 재시작).
   03 이후 ~ 배포 전 사이에는 옛 앱이 `role = 'admin'` 을 찾으므로 관리자 화면이 잠깐 막힌다 (수 분).
4. SQL `11` (전환 종료)
5. 확인
   ```sql
   select role, count(*) from profiles group by 1;          -- super_admin 4 (운영 기준)
   select count(*) from profiles where role = 'admin';      -- 0
   ```

리허설 (11/23 20:5x): 운영 DB 사본(`pg_dump farmassi` → 임시 DB)에 위 순서대로 01~11 적용 — 모두 성공.
결과 super_admin 4명(김미자·김이현·박지훈 8767·박지훈 8113), customer 21명, 농가 6곳 대표 그대로,
주문 13건·출고기록 180건 그대로. 01~11 을 한 번 더 돌려도 오류 없이 같은 상태. 사본은 지웠다.

되돌리기: 백업 복원이 가장 확실하다. SQL 은 모두 `create or replace`/`drop if exists` 라 다시 실행해도 안전하다.

## 함께 고친 것

- 처리 중 예외에도 CORS 헤더 (`server-py/app/main.py`) — 이전에는 DB 오류 사유 대신 '서버에 연결하지 못했습니다'가 떴다 (운영 포함).
- `protect_farm_fields`·`handle_new_user`·`auto_grant_admin` 이 `'admin'` 을 직접 보던 것 (SQL 04·08·10).
