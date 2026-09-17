import type { FnHandler } from './types.ts'
import { approveFarm } from './approveFarm.ts'
import { bankdaAccountStatus } from './bankdaAccountStatus.ts'
import { bankdaOtt } from './bankdaOtt.ts'
import { confirmDeposit } from './confirmDeposit.ts'
import { createOrder } from './createOrder.ts'
import { epostAddress } from './epostAddress.ts'
import { farmTodayQty } from './farmTodayQty.ts'
import { kpostShipment } from './kpostShipment.ts'
import { matchDeposit } from './matchDeposit.ts'
import { naverAddress } from './naverAddress.ts'
import { scrapeDeposits } from './scrapeDeposits.ts'
import { sendPushFn } from './sendPushFn.ts'

/** Edge Function 이름을 그대로 유지한다. 프론트의 호출부를 고치지 않기 위해서다. */
export const functions: Record<string, FnHandler> = {
  'approve-farm': approveFarm,
  'bankda-account-status': bankdaAccountStatus,
  'bankda-ott': bankdaOtt,
  'confirm-deposit': confirmDeposit,
  'create-order': createOrder,
  'epost-address': epostAddress,
  'farm-today-qty': farmTodayQty,
  'kpost-shipment': kpostShipment,
  'match-deposit': matchDeposit,
  'naver-address': naverAddress,
  'scrape-deposits': scrapeDeposits,
  'send-push': sendPushFn,
}
