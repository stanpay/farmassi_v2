import { useEffect, useState } from 'react'
import { invokeFunction } from './functions'

/** 서버에 시험 도구가 켜져 있는지. 꺼져 있으면(운영) 버튼을 그리지 않는다. */
export function useDevTestEnabled() {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    invokeFunction<{ enabled: boolean }>('dev-test', { action: 'status' })
      .then((r) => setEnabled(Boolean(r.enabled)))
      .catch(() => setEnabled(false))
  }, [])
  return enabled
}
