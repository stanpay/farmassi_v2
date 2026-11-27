#!/bin/bash
# 화면(src/lib/*.ts)과 서버(app/shared/order_review.py)의 주문 검수 판정이 같은지 대조한다.
#   server-py/test/review_parity/run.sh      (저장소 루트에 node_modules 가 있어야 한다)
# 한쪽 판정을 고치면 이걸 돌리고, 새 사례는 cases.json 에 더한다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
node "$ROOT/node_modules/rolldown/bin/cli.mjs" "$HERE/ts_ref.ts" --file "$OUT/ref.mjs" --platform node --format esm >/dev/null
# 브라우저 전용 import.meta.env 는 node 에 없다 — 판정 함수는 쓰지 않으므로 빈 값으로 둔다.
sed -i.bak 's/import\.meta\.env\./({}).x?./g; s/import\.meta\.env/({})/g' "$OUT/ref.mjs"
node "$OUT/ref.mjs" "$HERE/cases.json" > "$OUT/ts.json"
"$ROOT/server-py/.venv/bin/python" -I "$HERE/check.py" "$ROOT/server-py" "$HERE/cases.json" "$OUT/ts.json"
