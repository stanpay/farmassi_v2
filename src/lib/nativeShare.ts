import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/** android/.../share/FarmassiSharePlugin.java */
interface FarmassiSharePlugin {
  getSharedText(): Promise<{ text: string }>
  addListener(
    eventName: 'sharedText',
    listener: (data: { text: string }) => void,
  ): Promise<PluginListenerHandle>
}

const FarmassiShare = registerPlugin<FarmassiSharePlugin>('FarmassiShare')

const SHARED_ORDER_TEXT_KEY = 'farmassi-shared-order-text'

/** 로그인 전이면 로그인 후 이 주소로 돌아온다. 공유 글은 sessionStorage 에 남아 있다. */
export const SHARED_ORDER_PATH = '/farm/orders/new'

// 네이티브는 처음 공유 글을 한 번만 내준다. StrictMode 재마운트에도 같은 결과를 쓰도록 모듈에서 한 번만 꺼낸다.
let launchSharedText: Promise<string> | null = null

function takeLaunchSharedText() {
  launchSharedText ??= FarmassiShare.getSharedText()
    .then(({ text }) => text)
    .catch(() => '')
  return launchSharedText
}

export function peekSharedOrderText() {
  return sessionStorage.getItem(SHARED_ORDER_TEXT_KEY) ?? ''
}

export function clearSharedOrderText() {
  sessionStorage.removeItem(SHARED_ORDER_TEXT_KEY)
}

/** 안드로이드 앱에서 카톡·문자 공유로 글이 들어오면 저장해 두고 알린다. 웹에서는 아무것도 하지 않는다. */
export function listenForSharedOrderText(onShared: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}

  let disposed = false
  let handle: PluginListenerHandle | null = null

  const accept = (text: string) => {
    if (disposed || !text.trim()) return
    sessionStorage.setItem(SHARED_ORDER_TEXT_KEY, text)
    onShared()
  }

  void takeLaunchSharedText().then(accept)
  void FarmassiShare.addListener('sharedText', ({ text }) => accept(text)).then((next) => {
    if (disposed) void next.remove()
    else handle = next
  })

  return () => {
    disposed = true
    void handle?.remove()
  }
}
