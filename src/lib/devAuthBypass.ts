import { getCart, setCart } from './cart'
import type { Farm, Product, Profile } from '../types/models'
import type { Session } from './apiClient'

/** `npm run dev` + VITE_DEV_BYPASS_AUTH=true 일 때만. 프로덕션 빌드에는 절대 켜지지 않는다. */
export function isDevAuthBypass(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH === 'true'
}

export const DEV_BYPASS_USER_ID = '00000000-0000-4000-8000-0000000000ad'
export const DEV_BYPASS_FARM_ID = '00000000-0000-4000-8000-0000000000f1'

export const DEV_BYPASS_SESSION: Session = {
  access_token: 'dev-bypass-token',
  user: { id: DEV_BYPASS_USER_ID },
}

export const DEV_BYPASS_PROFILE: Profile = {
  id: DEV_BYPASS_USER_ID,
  role: 'admin',
  display_name: '로컬 관리자',
  phone: '010-0000-0000',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

/** API가 꺼져 있을 때 농가 워크스페이스용 임의 농가. URL 의 farmId 를 그대로 쓴다. */
export function createDevBypassFarm(farmId: string, slug = 'local-demo'): Farm {
  return {
    id: farmId,
    slug,
    name: '초록빛 농장',
    owner_user_id: DEV_BYPASS_USER_ID,
    location: '서울',
    product_summary: '데모 상품',
    description: '로컬 개발용 더미 농가',
    kakao_channel_url: null,
    phone: null,
    mobile_phone: null,
    address: null,
    address_zonecode: null,
    address_detail: null,
    map_url: null,
    share_text: null,
    landing_blocks: [],
    bank_name: '농협',
    account_number: '000-0000-0000-00',
    account_holder: '로컬데모',
    is_active: true,
    is_listed: true,
    delivery_days: [1, 2, 3, 4, 5],
    daily_qty_limit: 100,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

/** 손님 주문창(/farm/:slug/checkout)용 더미 농가·상품. */
export function createDevBypassCheckoutFarm(farmSlug: string): Farm {
  return createDevBypassFarm(DEV_BYPASS_FARM_ID, farmSlug || 'local-demo')
}

export function createDevBypassProducts(farmId: string): Product[] {
  const stamp = '2026-01-01T00:00:00.000Z'
  return [
    {
      id: '00000000-0000-4000-8000-0000000000p1',
      farm_id: farmId,
      name: '신선 방울토마토 1kg',
      price: 15000,
      list_price: 18000,
      shipping_fees: [{ qty: 1, fee: 3000 }],
      unit: '박스',
      description: '로컬 개발용 더미 상품',
      image_url: null,
      is_active: true,
      sale_status: 'on_sale',
      sort_order: 1,
      parcel_weight_kg: '1',
      parcel_volume_cm: '30x20x15',
      parcel_content_code: '농산물',
      parcel_delivery_type: '일반',
      daily_qty_limit: 50,
      per_order_qty_limit: 10,
      created_at: stamp,
      updated_at: stamp,
    },
    {
      id: '00000000-0000-4000-8000-0000000000p2',
      farm_id: farmId,
      name: '유기농 상추 500g',
      price: 8000,
      list_price: null,
      shipping_fees: [{ qty: 1, fee: 3000 }],
      unit: '팩',
      description: '로컬 개발용 더미 상품',
      image_url: null,
      is_active: true,
      sale_status: 'on_sale',
      sort_order: 2,
      parcel_weight_kg: '0.5',
      parcel_volume_cm: '25x20x10',
      parcel_content_code: '농산물',
      parcel_delivery_type: '일반',
      daily_qty_limit: 50,
      per_order_qty_limit: 10,
      created_at: stamp,
      updated_at: stamp,
    },
  ]
}

/** 장바구니가 비어 있으면 주문창 UI가 바로 뜨도록 더미 상품을 담는다. */
export function ensureDevBypassCart(farmSlug: string, products: Product[]) {
  if (getCart(farmSlug).length > 0) return
  setCart(
    farmSlug,
    products.slice(0, 2).map((product) => ({ productId: product.id, quantity: 1 })),
  )
}
