import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { copyText } from '../../lib/clipboard'
import { formatWon, normalizeAccountNumber } from '../../lib/format'

interface DepositGuideProps {
  bankName: string
  accountNumber: string
  accountHolder: string
  amount: number
}

function isRegistered(value: string | null | undefined): boolean {
  const text = value?.trim() ?? ''
  return text.length > 0 && text !== '미등록'
}

export function DepositGuide({
  bankName,
  accountNumber,
  accountHolder,
  amount,
}: DepositGuideProps) {
  const [copied, setCopied] = useState(false)
  const hasAccount = isRegistered(accountNumber)
  const hasBank = isRegistered(bankName)

  async function handleCopy() {
    const ok = await copyText(normalizeAccountNumber(accountNumber))
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="bg-primary-light border-primary/20 space-y-3">
      {hasAccount && hasBank ? (
        <>
          <p className="text-base font-semibold text-gray-900 leading-relaxed">
            {bankName.trim()} {accountNumber.trim()}으로 {formatWon(amount)}을 입금해주세요
          </p>
          {isRegistered(accountHolder) && (
            <p className="text-sm text-muted">예금주 {accountHolder.trim()}</p>
          )}
          <Button type="button" variant="outline" fullWidth onClick={() => void handleCopy()}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? '복사됨' : '계좌번호 복사'}
          </Button>
        </>
      ) : (
        <p className="text-sm text-gray-800">
          입금 계좌가 아직 등록되지 않았습니다. 농가에 문의해주세요.
        </p>
      )}
    </Card>
  )
}
