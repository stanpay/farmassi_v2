import type { CapacitorConfig } from '@capacitor/cli'

// 앱은 배포된 웹을 그대로 띄운다. 웹만 배포하면 앱 화면도 바로 바뀐다.
// 개발 서버를 보려면 CAP_SERVER_URL=http://<맥 IP>:5173 npx cap sync android
const serverUrl = (process.env.CAP_SERVER_URL ?? 'https://farmassi.kr').replace(/\/+$/, '')

const config: CapacitorConfig = {
  appId: 'kr.farmassi.app',
  appName: '팜어시',
  webDir: 'dist',
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith('http://'),
    // 여기 없는 주소로 이동하면 앱 밖 브라우저가 열려 로그인 콜백이 앱으로 돌아오지 못한다.
    allowNavigation: [
      'farmassi.kr',
      '*.farmassi.kr',
      'kakao.com',
      '*.kakao.com',
      '*.daum.net',
    ],
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
