import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { listenForSharedOrderText, SHARED_ORDER_PATH } from '../../lib/nativeShare'

/** 카톡·문자에서 공유한 글을 받으면 주문 '직접 추가하기'로 보낸다. */
export function NativeShareListener() {
  const navigate = useNavigate()

  useEffect(
    () => listenForSharedOrderText(() => navigate(SHARED_ORDER_PATH, { state: { sharedAt: Date.now() } })),
    [navigate],
  )

  return null
}
