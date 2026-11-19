import { useState } from 'react'
import { Download, ExternalLink, QrCode } from 'lucide-react'
import { Button } from '../ui/Button'
import { accountCopyUrl, canBuildAccountQr, downloadAccountQr } from '../../lib/accountQr'

export function AccountQrDownloadButton({
  farmName,
  bankName,
  accountNumber,
  accountHolder,
  farmSlug,
}: {
  farmName: string
  bankName: string
  accountNumber: string
  accountHolder: string
  farmSlug?: string
}) {
  const [pending, setPending] = useState(false)
  const ready = canBuildAccountQr(bankName, accountNumber, accountHolder, farmSlug)
  const link = ready && farmSlug ? accountCopyUrl(farmSlug) : ''

  async function handleDownload() {
    if (!ready || !farmSlug || pending) return
    setPending(true)
    try {
      await downloadAccountQr(farmName, bankName, accountNumber, accountHolder, farmSlug)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        fullWidth
        disabled={!ready || pending}
        onClick={() => void handleDownload()}
      >
        {pending ? <Download className="h-4 w-4 animate-pulse" /> : <QrCode className="h-4 w-4" />}
        {pending ? '생성 중…' : '계좌 QR PDF 다운로드'}
      </Button>
      {ready ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          fullWidth
          onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink className="h-4 w-4" />
          QR 링크 새 창에서 열기
        </Button>
      ) : null}
    </div>
  )
}
