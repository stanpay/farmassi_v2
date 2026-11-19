import { fail, ok, type FnHandler } from './types.ts'
import { jusoRoadBase, lookupJusoBuilding } from './jusoBuildingLookup.ts'

export const jusoBuilding: FnHandler = async (ctx) => {
  if (!ctx.userId) return fail('로그인이 필요합니다.', 401)
  const road = jusoRoadBase(String(ctx.body?.address ?? ''))
  if (road.length < 2) return fail('주소를 입력해 주세요.')
  const dong = String(ctx.body?.dong ?? '').trim()
  try {
    return ok(
      await lookupJusoBuilding(road, dong, {
        searchKey: (process.env.JUSO_SEARCH_API_KEY ?? '').trim(),
        detailKey: (process.env.JUSO_DETAIL_API_KEY ?? '').trim(),
      }),
    )
  } catch (error) {
    return fail(error instanceof Error ? error.message : '도로명주소 조회에 실패했습니다.', 500)
  }
}
