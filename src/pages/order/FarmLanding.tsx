import { Leaf } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Header } from '../../components/layout/Header'
import { SiteFooter } from '../../components/layout/SiteFooter'
import { useLoginSheet } from '../../components/auth/LoginSheet'
import { FarmInquiryButtons } from '../../components/shared/KakaoChannelButton'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PageSpinner } from '../../components/ui/Feedback'
import { useAuth } from '../../lib/auth'
import { farmDisplayLocation } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { parseLandingBlocks, type Farm } from '../../types/models'

export function FarmLanding() {
  const { farmSlug = '' } = useParams()
  const { user, isAdmin, signOut } = useAuth()
  const { openLogin } = useLoginSheet()
  const [farm, setFarm] = useState<Farm | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('farms')
      .select('*')
      .eq('slug', farmSlug)
      .maybeSingle()
      .then(({ data }) => {
        const row = (data as Farm | null) ?? null
        setFarm(row ? { ...row, landing_blocks: parseLandingBlocks(row.landing_blocks) } : null)
        setLoading(false)
      })
  }, [farmSlug])

  if (loading) return <PageSpinner />
  if (!farm) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-muted">
        농가를 찾을 수 없습니다
      </div>
    )
  }

  const blocks = parseLandingBlocks(farm.landing_blocks)

  return (
    <div className="bg-surface">
      <div className="flex min-h-dvh flex-col">
        <Header
          title={farm.name}
          subtitle={farmDisplayLocation(farm, '농가 직송')}
          copyableSubtitle={Boolean(farm.address?.trim())}
          rightElement={
            <div className="flex items-center gap-3">
              {isAdmin && (
                <Link to="/admin/farms" className="text-sm font-medium text-muted hover:text-gray-900">
                  관리자 페이지
                </Link>
              )}
              {user ? (
                <button type="button" onClick={() => void signOut()} className="text-sm text-muted">
                  로그아웃
                </button>
              ) : (
                <button type="button" onClick={() => openLogin()} className="text-sm font-semibold text-primary">
                  로그인
                </button>
              )}
            </div>
          }
        />
        <div className="flex-1 px-4 py-6 md:px-6 max-w-5xl mx-auto w-full space-y-6">
          {blocks.length > 0 ? (
            <section className="space-y-4">
              {blocks.map((block) => (
                <Card key={block.id} className={block.image_url ? 'overflow-hidden p-0' : ''}>
                  {block.image_url ? (
                    <img src={block.image_url} alt="" className="block w-full h-auto" />
                  ) : null}
                  {block.body ? (
                    <p
                      className={`whitespace-pre-wrap text-sm leading-6 text-gray-700 ${
                        block.image_url ? 'p-4' : ''
                      }`}
                    >
                      {block.body}
                    </p>
                  ) : null}
                </Card>
              ))}
            </section>
          ) : (
            <>
              <div className="rounded-2xl bg-primary p-6 text-white">
                <div className="flex items-center gap-2 mb-2">
                  <Leaf className="h-5 w-5" />
                  <span className="text-sm text-white/80">{farmDisplayLocation(farm, '농가 직송')}</span>
                </div>
                <h2 className="text-2xl font-bold">{farm.name}</h2>
                <p className="mt-2 text-sm text-white/80">
                  {farm.description || farm.product_summary || '농가에서 바로, 신선한 직송'}
                </p>
              </div>
              {farm.product_summary && farm.description ? (
                <Card>
                  <p className="text-sm font-semibold text-gray-900">주요 품목</p>
                  <p className="mt-1 text-sm text-gray-700">{farm.product_summary}</p>
                </Card>
              ) : null}
            </>
          )}
        </div>
      </div>

      <SiteFooter className="pb-40" />

      <div className="fixed bottom-0 left-0 right-0 z-20 p-4 pointer-events-none">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 pointer-events-auto">
          <FarmInquiryButtons
            kakaoChannelUrl={farm.kakao_channel_url}
            phone={farm.phone}
            mobilePhone={farm.mobile_phone}
          />
          {farm.is_active ? (
            <Link to={`/farm/${farm.slug}`} className="block">
              <Button size="lg" fullWidth>
                주문하기
              </Button>
            </Link>
          ) : (
            <>
              <Button size="lg" fullWidth disabled>
                지금은 주문을 받지 않습니다
              </Button>
              <Link to={`/farm/${farm.slug}`} className="block text-center text-sm text-primary">
                상품 둘러보기
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
