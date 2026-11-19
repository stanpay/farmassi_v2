import QRCode from 'qrcode'
import { jsPDF } from 'jspdf'
import { farmQrUrl } from './farmShareText'

const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297
const DPI = 150
const PX_PER_MM = DPI / 25.4
const PRIMARY_GREEN = '#1b7e3c'
const KAKAO_YELLOW = '#FEE500'
const KAKAO_TEXT = 'rgba(0,0,0,0.85)'
const KAKAO_PATH =
  'M9 1.2C4.306 1.2.5 4.29.5 8.1c0 2.4 1.56 4.51 3.93 5.73L3.4 17.4c-.05.2.16.36.34.26l4.18-2.77c.35.05.71.07 1.08.07 4.694 0 8.5-3.09 8.5-6.9S13.694 1.2 9 1.2Z'

/** lucide Package (24×24) */
const PACKAGE_PATHS = [
  'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z',
  'M12 22V12',
  'm3.3 7 8.7 5 8.7-5',
  'm7.5 4.27 9 5.15',
]

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('QR 이미지를 불러오지 못했습니다.'))
    img.src = src
  })
}

function drawKakaoSymbol(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const scale = size / 18
  const nudgeUp = size * (1.5 / 18)
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2 - nudgeUp)
  ctx.scale(scale, scale)
  ctx.fillStyle = '#191919'
  ctx.fill(new Path2D(KAKAO_PATH), 'evenodd')
  ctx.restore()
}

function drawPackageIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const scale = size / 24
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(scale, scale)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2.25
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const d of PACKAGE_PATHS) {
    ctx.stroke(new Path2D(d))
  }
  ctx.restore()
}

function drawRoundedButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
) {
  const radius = Math.round(12 * (DPI / 96))
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.fill()
}

/** 웹 버튼처럼 아이콘+글자를 버튼 정중앙에 배치 */
function drawCenteredIconLabel(
  ctx: CanvasRenderingContext2D,
  btnX: number,
  btnY: number,
  btnW: number,
  btnH: number,
  {
    label,
    color,
    weight,
    baseSize,
    iconSize,
    iconGap,
    drawIcon,
  }: {
    label: string
    color: string
    weight: string
    baseSize: number
    iconSize: number
    iconGap: number
    drawIcon: (cx: number, cy: number, size: number) => void
  },
) {
  const fontSize = fitText(
    ctx,
    label,
    btnW - iconSize - iconGap - Math.round(8 * PX_PER_MM),
    baseSize,
    weight,
  )
  ctx.font = `${weight} ${fontSize}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
  const textW = ctx.measureText(label).width
  const groupW = iconSize + iconGap + textW
  const startX = btnX + (btnW - groupW) / 2
  // 두 버튼 동일: 기하 중심 + 한글 광학 보정(동일 오프셋)
  const midY = btnY + btnH / 2 + Math.round(fontSize * 0.08)

  drawIcon(startX + iconSize / 2, midY, iconSize)

  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, startX + iconSize + iconGap, midY)
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  baseSize: number,
  weight: string,
) {
  let size = baseSize
  const fontFamily = '"Apple SD Gothic Neo", "Malgun Gothic", sans-serif'
  while (size > baseSize * 0.55) {
    ctx.font = `${weight} ${size}px ${fontFamily}`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 1
  }
  return size
}

/** 스캔 시 계좌 QR 페이지로 연결되는 짧은 URL */
export function accountCopyUrl(farmSlug: string) {
  return farmQrUrl(farmSlug.trim())
}

export function canBuildAccountQr(
  bankName: string,
  accountNumber: string,
  accountHolder: string,
  farmSlug?: string,
) {
  return Boolean(
    bankName.trim() && accountNumber.trim() && accountHolder.trim() && farmSlug?.trim(),
  )
}

export async function downloadAccountQr(
  farmName: string,
  bankName: string,
  accountNumber: string,
  accountHolder: string,
  farmSlug: string,
) {
  const name = farmName.trim()
  const bank = bankName.trim()
  const accountDisplay = accountNumber.trim()
  const holder = accountHolder.trim()
  const qrPayload = accountCopyUrl(farmSlug)

  const widthPx = Math.round(A4_WIDTH_MM * PX_PER_MM)
  const heightPx = Math.round(A4_HEIGHT_MM * PX_PER_MM)
  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들 수 없습니다.')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, widthPx, heightPx)

  const centerX = widthPx / 2
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  // 상단 농가명
  const farmNameY = Math.round(22 * PX_PER_MM)
  const farmNameSize = Math.round(24 * PX_PER_MM)
  ctx.fillStyle = '#111111'
  ctx.font = `700 ${farmNameSize}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
  ctx.fillText(name || '농가', centerX, farmNameY)

  // QR을 농가명 바로 아래로 (하단 버튼 공간 확보)
  const qrSizeMm = 100
  const qrSizePx = Math.round(qrSizeMm * PX_PER_MM)
  const qrX = (widthPx - qrSizePx) / 2
  const qrY = farmNameY + farmNameSize + Math.round(10 * PX_PER_MM)

  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    width: qrSizePx,
    margin: 1,
    errorCorrectionLevel: 'M',
  })
  const qrImage = await loadImage(qrDataUrl)
  ctx.drawImage(qrImage, qrX, qrY, qrSizePx, qrSizePx)

  const bankSize = Math.round(12 * PX_PER_MM)
  const accountSize = Math.round(16 * PX_PER_MM)
  const holderSize = Math.round(12 * PX_PER_MM)
  const lineGap = Math.round(16 * PX_PER_MM)
  let textY = qrY + qrSizePx + Math.round(12 * PX_PER_MM)

  ctx.fillStyle = '#111111'
  ctx.font = `600 ${bankSize}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
  ctx.fillText(bank, centerX, textY)
  textY += lineGap

  ctx.font = `700 ${accountSize}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
  ctx.fillText(accountDisplay, centerX, textY)
  textY += lineGap

  ctx.font = `600 ${holderSize}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
  ctx.fillText(holder, centerX, textY)

  // 하단: 카카오 / 간편 택배 주문 동일 크기 가로 배치
  const marginX = Math.round(18 * PX_PER_MM)
  const gap = Math.round(4 * PX_PER_MM)
  const btnH = Math.round(14 * PX_PER_MM)
  const btnW = (widthPx - marginX * 2 - gap) / 2
  const captionSize = Math.round(5.5 * PX_PER_MM)
  const captionGap = Math.round(5 * PX_PER_MM)
  const bottomPad = Math.round(36 * PX_PER_MM)
  const btnY = heightPx - bottomPad - captionSize - captionGap - btnH * 2
  const leftX = marginX
  const rightX = marginX + btnW + gap
  const iconSize = Math.round(5.5 * PX_PER_MM)
  const labelBase = Math.round(4.2 * PX_PER_MM)
  const iconGap = Math.round(2 * PX_PER_MM)

  // 카카오 버튼 (노랑) — 문구는 농가명
  drawRoundedButton(ctx, leftX, btnY, btnW, btnH, KAKAO_YELLOW)
  drawCenteredIconLabel(ctx, leftX, btnY, btnW, btnH, {
    label: name || '농가',
    color: KAKAO_TEXT,
    weight: '500',
    baseSize: labelBase,
    iconSize,
    iconGap,
    drawIcon: (cx, cy, size) => drawKakaoSymbol(ctx, cx, cy, size),
  })

  // 간편 택배 주문 버튼 (초록)
  drawRoundedButton(ctx, rightX, btnY, btnW, btnH, PRIMARY_GREEN)
  drawCenteredIconLabel(ctx, rightX, btnY, btnW, btnH, {
    label: '간편 택배 주문',
    color: '#ffffff',
    weight: '600',
    baseSize: labelBase,
    iconSize,
    iconGap,
    drawIcon: (cx, cy, size) => drawPackageIcon(ctx, cx, cy, size),
  })

  // 카카오 버튼 아래 안내 (크게)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#4b5563'
  ctx.font = `600 ${captionSize}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`
  ctx.fillText(
    '채널추가 하시고 소식 받아보세요',
    leftX + btnW / 2,
    btnY + btnH + captionGap,
  )

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  })
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM)
  pdf.save(`${name || holder || '계좌'}_QR.pdf`)
}
