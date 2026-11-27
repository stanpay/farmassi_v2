import { readFileSync } from 'node:fs'
import * as E from '../../../src/lib/epostAddress'
import * as J from '../../../src/lib/jusoBuilding'
import { normalizePhone } from '../../../src/lib/phone'
import { matchFarmProduct } from '../../../src/lib/matchFarmProduct'
const c = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const out: any = {}
out.split = c.addresses.map((a: string) => { const r = E.splitAddressParts(a); return [r.address, r.addressDetail] })
out.norm = c.addresses.map((a: string) => { const r = E.normalizeAddressParts(a, ''); return [r.address, r.addressDetail] })
out.query = c.addresses.map(E.buildEpostSearchQuery)
out.fallback = c.addresses.map(E.buildEpostFallbackQueries)
out.extract = c.addresses.flatMap((a: string) => c.roads.map((r: string) => E.extractAddressDetail(a, r)))
const res = (r: string) => ({ id: r, zipNo: '1', roadAddress: r, jibunAddress: '' })
out.matches = c.addresses.flatMap((a: string) => c.roads.map((r: string) => E.matchesEpostResult(a, res(r))))
out.district = c.addresses.flatMap((a: string) => c.roads.map((r: string) => { const d = E.findDistrictMismatch(a, res(r)); return d ? [d.original, d.epost] : null }))
out.dongho = c.details.map((d: string) => { const r = J.parseDongHo(d); return [r.dong, r.ho] })
const infos = [{ found: true, apartment: true, buildingName: '', dongs: ['101동','102동','103동','104동','105동'], hos: ['801','802','1001'], hoDong: '103동' },
  { found: true, apartment: false, buildingName: '', dongs: [], hos: null, hoDong: null },
  { found: true, apartment: true, buildingName: '', dongs: ['가동'], hos: ['101','102'], hoDong: '가동' }]
out.judge = infos.flatMap((i) => c.details.map((d: string) => { const r = J.parseDongHo(d); return J.judgeAddressDetail(i as any, r.dong, r.ho) }))
out.phone = c.phones.map(normalizePhone)
out.product = c.products.map(([q, names]: [string, string[]]) => matchFarmProduct(q, names.map((n, i) => ({ id: String(i), name: n, sale_status: 'on_sale', is_active: true } as any)))?.product.id ?? null)
console.log(JSON.stringify(out))
