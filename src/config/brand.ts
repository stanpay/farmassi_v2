// 공유 문구의 랜딩 링크가 이 주소를 쓴다. 배포 도메인이 바뀌면 .env 만 고치면 된다.
const SITE_URL = (import.meta.env.VITE_SITE_URL ?? 'https://farmassi.kr').replace(/\/+$/, '')

export const BRAND = {
  serviceName: '팜어시',
  serviceNameEn: 'Farmassi',
  companyName: '스테이블 퓨전',
  companyNameEn: 'Stable Fusion',
  ceoName: '박지훈',
  companyAddress: '제주특별자치도 제주시 동문로9길 13-1, 2층 스테이블 퓨전',
  businessNumber: '658-36-01689',
  contactEmail: 'contact@stan.ai.kr',
  tagline: '농가 직송 신선 농산물',
  siteUrl: SITE_URL,
} as const

