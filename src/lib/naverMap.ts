import { invokeFunction } from './functions'

export interface AddressCandidate {
  id: string
  name: string
  address: string
  zonecode: string
  lat: number
  lng: number
}

interface KakaoLatLng {
  getLat(): number
  getLng(): number
}

interface KakaoMap {
  setCenter(latlng: KakaoLatLng): void
  relayout(): void
}

interface KakaoMarker {
  setMap(map: KakaoMap | null): void
  setPosition(latlng: KakaoLatLng): void
}

interface KakaoMapsSdk {
  LatLng: new (lat: number, lng: number) => KakaoLatLng
  Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap
  Marker: new (options: { position: KakaoLatLng; map: KakaoMap }) => KakaoMarker
  event: {
    addListener(target: KakaoMap, type: 'click', handler: (e: { latLng: KakaoLatLng }) => void): void
    removeListener(target: KakaoMap, type: 'click', handler: (e: { latLng: KakaoLatLng }) => void): void
  }
  load(callback: () => void): void
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMapsSdk }
  }
}

let mapsReady: Promise<KakaoMapsSdk> | null = null

function getAppKey() {
  const key = import.meta.env.VITE_KAKAO_JS_KEY
  if (!key) throw new Error('카카오 지도 JavaScript 키(VITE_KAKAO_JS_KEY)가 설정되지 않았습니다.')
  return key
}

export function loadKakaoMaps(): Promise<KakaoMapsSdk> {
  if (window.kakao?.maps?.LatLng) return Promise.resolve(window.kakao.maps)
  if (mapsReady) return mapsReady

  mapsReady = new Promise((resolve, reject) => {
    const finish = () => {
      if (!window.kakao?.maps) {
        mapsReady = null
        reject(new Error('카카오 지도를 불러오지 못했습니다.'))
        return
      }
      window.kakao.maps.load(() => {
        if (!window.kakao?.maps?.LatLng) {
          mapsReady = null
          reject(new Error('카카오 지도를 불러오지 못했습니다.'))
          return
        }
        resolve(window.kakao.maps)
      })
    }

    const existing = document.getElementById('kakao-maps-sdk')
    if (existing) {
      if (window.kakao?.maps) {
        finish()
      } else {
        existing.addEventListener('load', finish, { once: true })
        existing.addEventListener(
          'error',
          () => {
            mapsReady = null
            reject(new Error('카카오 지도를 불러오지 못했습니다.'))
          },
          { once: true },
        )
      }
      return
    }

    const script = document.createElement('script')
    script.id = 'kakao-maps-sdk'
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${getAppKey()}&autoload=false`
    script.async = true
    script.onload = finish
    script.onerror = () => {
      mapsReady = null
      script.remove()
      reject(
        new Error(
          '카카오 지도를 불러오지 못했습니다. 카카오 개발자 콘솔 Web 플랫폼에 도메인(localhost, farmassi.kr)이 등록돼 있는지 확인하세요.',
        ),
      )
    }
    document.head.appendChild(script)
  })

  return mapsReady
}

export async function searchAddresses(query: string): Promise<AddressCandidate[]> {
  const data = await invokeFunction<{ results?: AddressCandidate[] }>('naver-address', {
    action: 'search',
    query,
  })
  return data.results ?? []
}

export async function coordToAddress(lat: number, lng: number): Promise<AddressCandidate> {
  const data = await invokeFunction<{ result: AddressCandidate }>('naver-address', {
    action: 'reverse',
    lat,
    lng,
  })
  return data.result
}

export async function enrichZonecode(candidate: AddressCandidate): Promise<AddressCandidate> {
  if (candidate.zonecode) return candidate
  try {
    const fromCoord = await coordToAddress(candidate.lat, candidate.lng)
    return {
      ...candidate,
      zonecode: fromCoord.zonecode || candidate.zonecode,
      address: candidate.address || fromCoord.address,
    }
  } catch {
    return candidate
  }
}

export async function getCurrentAddress(): Promise<AddressCandidate> {
  const position = await getCurrentPosition()
  return coordToAddress(position.coords.latitude, position.coords.longitude)
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 브라우저는 위치 정보를 지원하지 않습니다.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('위치 권한을 허용해 주세요.'))
          return
        }
        reject(new Error('현재 위치를 확인할 수 없습니다.'))
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30_000 },
    )
  })
}

export function createAddressMap(
  container: HTMLElement,
  candidate: AddressCandidate,
  onMove: (next: AddressCandidate) => void,
): () => void {
  const maps = window.kakao?.maps
  if (!maps?.LatLng) throw new Error('카카오 지도를 불러오지 못했습니다.')

  container.classList.add('kakao-map')
  container.replaceChildren()
  const center = new maps.LatLng(candidate.lat, candidate.lng)
  const map = new maps.Map(container, { center, level: 3 })
  const marker = new maps.Marker({ position: center, map })

  const relayout = () => {
    map.relayout()
    map.setCenter(center)
  }
  requestAnimationFrame(relayout)
  const relayoutTimer = window.setTimeout(relayout, 120)

  const onClick = (event: { latLng: KakaoLatLng }) => {
    const lat = event.latLng.getLat()
    const lng = event.latLng.getLng()
    marker.setPosition(event.latLng)
    void coordToAddress(lat, lng)
      .then(onMove)
      .catch(() => {
        /* keep previous address if reverse geocode fails */
      })
  }
  maps.event.addListener(map, 'click', onClick)

  return () => {
    window.clearTimeout(relayoutTimer)
    try {
      maps.event.removeListener(map, 'click', onClick)
    } catch {
      /* ignore */
    }
    try {
      marker.setMap(null)
    } catch {
      /* ignore */
    }
    try {
      if (container.isConnected) container.replaceChildren()
    } catch {
      /* ignore */
    }
  }
}
