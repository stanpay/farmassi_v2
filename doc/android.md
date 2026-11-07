# 안드로이드 앱

웹앱을 Capacitor 로 감싼 APK 다. Play 스토어가 아니라 농가에 파일로 나눠 설치한다.

앱은 `https://farmassi.kr` 을 그대로 띄운다. 웹만 배포하면 앱 화면도 바뀐다. 네이티브가 맡는 일은 두 가지다.

1. 카카오톡·문자에서 공유한 글을 **직접 추가하기** 로 넘긴다.
2. 전화가 끝나면 **콜백문자** 를 폰 요금제로 보낸다.

## 빌드

맥에 JDK 21 과 Android SDK 가 있어야 한다.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
npm run apk:debug
```

결과물: `android/app/build/outputs/apk/debug/app-debug.apk`

개발 서버를 보려면 맥 IP 를 넣고 동기화한다.

```bash
CAP_SERVER_URL=http://192.168.0.10:5173 npx cap sync android
```

## 공유받기

카카오톡이나 문자에서 공유 → 팜어시. `text/plain` 만 받는다.

앱이 글을 받아 `/farm/orders/new` 로 보낸다. 로그인되어 있으면 그 농가의 직접 추가하기 화면에 원문이 들어가고 바로 변환한다. 로그인이 아니면 로그인 뒤에 이어서 처리한다. 글은 `sessionStorage` 의 `farmassi-shared-order-text` 에 잠시 둔다.

## 카카오 로그인

카카오톡은 HTTPS 로만 돌아온다. 앱에서 로그인하면 `/auth/callback?native=1` 로 돌아온 뒤 `kr.farmassi.app://auth/callback` 으로 앱을 연다. 웹 프론트가 배포되어 있어야 한다. APK 만 다시 깔아서는 부족하다.

## 콜백문자

설정 화면은 농가 메뉴 **자동문자** (`/admin/farms/:farmId/auto-sms`). 문구는 `farms.share_text`(안내 문자)다. 규칙은 안드로이드 앱에서만 기기 안에 저장한다. 서버로 보내지 않는다.

필요한 권한: 전화 상태, 통화 기록, 문자 보내기, 다른 앱 위에 표시(자동 발신이 꺼져 있을 때 선택 팝업), 배터리 최적화 해제.

앱을 강제 종료하면 전화 감지가 멈춘다. 삼성 등 제조사 절전도 별도로 꺼야 한다.
