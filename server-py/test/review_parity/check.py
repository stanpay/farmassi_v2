"""주문 검수 판정 대조: 화면(TS) 결과 JSON 과 서버(order_review.py) 결과가 같은지 본다. run.sh 로 돌린다."""
import json, sys
sys.path.insert(0, sys.argv[1])
from app.shared import order_review as rv
c = json.load(open(sys.argv[2])); js = json.load(open(sys.argv[3]))
out = {}
out["split"] = [list(rv.split_address_parts(a)) for a in c["addresses"]]
out["norm"] = [list(rv.normalize_address_parts(a, "")) for a in c["addresses"]]
out["query"] = [rv.build_epost_search_query(a) for a in c["addresses"]]
out["fallback"] = [rv.build_epost_fallback_queries(a) for a in c["addresses"]]
out["extract"] = [rv.extract_address_detail(a, r) for a in c["addresses"] for r in c["roads"]]
res = lambda r: {"id": r, "zipNo": "1", "roadAddress": r, "jibunAddress": ""}
out["matches"] = [rv.matches_epost_result(a, res(r)) for a in c["addresses"] for r in c["roads"]]
out["district"] = [(lambda d: list(d) if d else None)(rv.find_district_mismatch(a, res(r))) for a in c["addresses"] for r in c["roads"]]
out["dongho"] = [list(rv.parse_dong_ho(d)) for d in c["details"]]
infos = [{"found": True, "apartment": True, "dongs": ['101동','102동','103동','104동','105동'], "hos": ['801','802','1001'], "hoDong": '103동'},
  {"found": True, "apartment": False, "dongs": [], "hos": None, "hoDong": None},
  {"found": True, "apartment": True, "dongs": ['가동'], "hos": ['101','102'], "hoDong": '가동'}]
out["judge"] = [(lambda p: rv.detail_problem_message(p) if p else None)(rv.judge_address_detail(i, *rv.parse_dong_ho(d))) for i in infos for d in c["details"]]
out["phone"] = [rv.normalize_phone(p) for p in c["phones"]]
out["product"] = [(lambda h: h["id"] if h else None)(rv.match_farm_product(q, [{"id": str(i), "name": n} for i, n in enumerate(names)])) for q, names in c["products"]]
bad = 0
for k in js:
    for i, (a, b) in enumerate(zip(js[k], out[k])):
        if a != b:
            bad += 1; print("DIFF", k, i, "js=", a, "py=", b)
    if len(js[k]) != len(out[k]): print("LEN", k)
print("checked", sum(len(v) for v in js.values()), "diffs", bad)
sys.exit(1 if bad else 0)
