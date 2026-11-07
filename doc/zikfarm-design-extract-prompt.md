# Flutter Web UI 픽셀 스펙 추출 프롬프트 (통합본)

외부 AI / 에이전트 / 수동 작업에 그대로 붙여 넣는 통합 프롬프트다.  
대상이 Flutter Web(CanvasKit)인 경우 CSS `padding`/`margin`이 DOM에 없으므로, Semantics 박스 좌표로 간격을 역산한다.

이 문서는 다음을 포함한다.

1. 픽셀 스펙 추출  
2. React 컴포넌트 이관 초안(후보)  
3. **웹에서 열어보는 디자인 시스템 카탈로그** (컴포넌트명 + 실제 화면 생김새 미리보기)

비슷해 보이는 요소를 **하나의 컴포넌트로 합치는 최종 결정은 사람이 검수**한다. AI/에이전트는 합치지 말고 **후보만** 제안한다.

---

## 사용법

1. 아래 **「프롬프트 본문」** 전체를 복사한다.
2. 아래 치환 표를 채운다.
3. 브라우저 DevTools 콘솔 또는 AI 브라우저 도구로 측정 스크립트를 실행한다.
4. 출력 포맷을 지키지 않은 결과는 폐기하고 재측정한다.
5. `{CATALOG_PATH}` HTML을 브라우저로 열어 컴포넌트별 이름·미리보기를 검수한다.
6. **섹션 6(컴포넌트 후보)** 의 `decision`을 사람이 채운 뒤에만 React 구현/합치기를 진행한다.

### 권장 치환 값 (직팜)

| 변수 | 권장 값 |
|---|---|
| `{TARGET_URL}` | `https://www.zikfarm.com/` |
| `{VIEWPORT_WIDTH}` | `390` |
| `{VIEWPORT_HEIGHT}` | `844` |
| `{OUTPUT_PATH}` | `design-spec/zikfarm-home.md` |
| `{COMPONENT_REVIEW_PATH}` | `design-spec/zikfarm-component-candidates.md` |
| `{CATALOG_PATH}` | `design-spec/catalog/index.html` |
| `{PREVIEW_DIR}` | `design-spec/catalog/previews/` |

보조 대상(동일 방식): `https://partners.zikfarm.com/signin`

### 산출물 한눈에

| 산출물 | 용도 | 보는 방법 |
|---|---|---|
| `{OUTPUT_PATH}` | 페이지 픽셀 스펙 | 에디터/MD |
| `{COMPONENT_REVIEW_PATH}` | 합치기 검수표 | 에디터/MD |
| `{CATALOG_PATH}` + `{PREVIEW_DIR}` | **디자인 시스템 웹 카탈로그** | 브라우저로 `index.html` 오픈 |

---

## 프롬프트 본문

````markdown
# 역할
너는 UI 스펙 추출기다. 목표 사이트를 **픽셀 단위로 재현**할 수 있도록
레이아웃·간격·타이포·색을 측정해 문서로 남긴다.
추가로 React로 옮길 **컴포넌트 후보**를 제안하되, **합치기/분리 최종 결정은 하지 않는다.**
완성된 결과는 **브라우저에서 열리는 디자인 시스템 카탈로그**로도 제출한다.
카탈로그의 각 카드에는 반드시 **컴포넌트 명**과 **실제 웹에서 보이는 생김새(원본 스크린샷 크롭)** 가 함께 보여야 한다.
추측·눈대중·“약 Npx” 표현은 금지한다. 측정되지 않으면 `unknown` + 근거를 남긴다.

# 대상
- URL: {TARGET_URL}
- 기술 가정: Flutter Web (CanvasKit / Skwasm). UI는 `<canvas>`에 그려진다.
- 일반 HTML의 `getComputedStyle().padding` / `margin` / `gap`은 **존재하지 않거나 무의미**하다.
- 측정 수단: Semantics 활성화 후 `flt-semantics`의 `getBoundingClientRect()`로
  박스·inset·gap을 역산한다.
- 페이지가 일반 DOM(React/Next 등)이면 부록 A의 CSS 경로를 쓰고, Flutter면 본문 규칙을 쓴다.
  판별: `document.querySelector('flutter-view')` 존재 여부.

# 필수 환경 (측정 전 고정)
1. 뷰포트: width={VIEWPORT_WIDTH}, height={VIEWPORT_HEIGHT}. `devicePixelRatio`를 기록한다. (모바일 기준 권장: 390×844, DPR=2)
2. 페이지 완전 로드 대기(네트워크 idle 또는 주요 텍스트 노출).
3. Semantics 활성화:
   - `document.querySelector('flt-semantics-placeholder')?.click()`
   - 또는 a11y "Enable accessibility" 버튼
   - `document.querySelectorAll('flt-semantics').length > 0` 확인
4. `scrollX === 0`, 필요 시 섹션별 `scrollY`를 기록한 뒤 측정.
5. 동일 페이지를 **mobile({VIEWPORT_WIDTH})** 기준으로 먼저 측정하고,
   필요 시 tablet(768)을 추가로 측정해 breakpoint 차이를 기록한다.
6. 다크모드/시스템 폰트 강제 없음. 기본 라이트 UI 기준.

# 절대 금지
- 눈대중, "~정도", "약 20px", "비슷하게" 금지. 반드시 정수 px 또는 `unknown`.
- `#flt-semantic-node-N` ID만으로 요소를 식별하지 말 것 (리빌드마다 변함).
- Flutter에서 CSS class/selector를 재현 스펙의 유일한 키로 쓰지 말 것.
- 추측 hex 색 금지. 스크린샷 픽셀 샘플 또는 명시된 토큰만.
- DPR로 CSS px를 나누거나 곱해 “실제 픽셀”로 환산하지 말 것. 기록 단위는 **CSS px**.
- 한 화면에 안 보이는 요소를 생략하고 “없음”으로 쓰지 말 것. 스크롤·탭 이동 후 재측정.
- 비슷해 보이는 요소를 **임의로 하나의 React 컴포넌트로 합치지 말 것.**
  차이는 전부 기록하고, 합치기 여부는 `decision: pending`으로 사람 검수에 맡긴다.
- 검수 전 React 구현 코드·PR·파일 생성을 단정하지 말 것. 후보는 스펙/표만.

# 측정 파이프라인 (순서 고정)

## Step 0 — 프레임워크 판별
```js
({
  url: location.href,
  isFlutter: !!document.querySelector('flutter-view') || !!window._flutter,
  hasCanvasInGlass:
    !!document.querySelector('flt-glass-pane')?.shadowRoot?.querySelector('canvas'),
  vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
})
```
`isFlutter === true` → Step 1~4.  
`false` → 부록 A.

## Step 1 — Semantics 덤프 (raw 보존)
```js
(() => {
  document.querySelector('flt-semantics-placeholder')?.click();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return wait(400).then(() => {
    const nodes = [...document.querySelectorAll('flt-semantics')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.id,
        role: el.getAttribute('role'),
        label: el.getAttribute('aria-label') || '',
        text: (el.innerText || '').trim(),
        tappable: el.hasAttribute('flt-tappable'),
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      };
    }).filter((n) => n.w > 0 && n.h > 0);

    return {
      meta: {
        url: location.href,
        vw: innerWidth,
        vh: innerHeight,
        dpr: devicePixelRatio,
        scrollX: scrollX,
        scrollY: scrollY,
        semanticsCount: nodes.length,
      },
      nodes,
    };
  });
})();
```
출력 JSON은 버리지 말고 raw로 보관한다.

## Step 2 — 간격 역산 규칙 (padding/margin 대체)
부모 A, 자식 B, 형제 B1 → B2:

| 개념 | 계산식 |
|---|---|
| inset-left / margin-left | `B.x - A.x` |
| inset-right / margin-right | `A.right - B.right` |
| inset-top / margin-top | `B.y - A.y` |
| inset-bottom / margin-bottom | `A.bottom - B.bottom` |
| gap-x | `B2.x - B1.right` |
| gap-y | `B2.y - B1.bottom` |
| 내부 padding(추정) | 첫 자식의 inset + 마지막 자식의 inset (명시적으로 `estimated` 표기) |
| size | `w × h` |

규칙:
- 모든 값은 `Math.round` 후 정수 CSS px.
- 음수 gap은 오버랩으로 기록: `overlap: N`.
- 부모가 불명확하면 viewport(`0,0,vw,vh`)를 부모로 쓴다.
- 고정 헤더/바텀바는 `position: fixed(equivalent)`로 표시하고, 스크롤 영역 높이와 겹침을 기록한다.

## Step 3 — 색·타이포·라디우스
1. 전체 화면 + 각 주요 섹션 스크린샷을 찍는다.
2. 배경/텍스트/accent/보더를 픽셀 샘플 → `#RRGGBB` (가능하면 alpha 포함).
3. 텍스트:
   - Semantics `text`/`label`로 문자열 확정
   - bbox 높이 + 스크린샷 글자 높이로 `font-size` 후보 확정
   - weight는 Regular / Medium / Bold만. 불확실하면 `unknown`
   - line-height는 다중 라인 bbox와 줄수로 추정 가능할 때만. 아니면 `unknown`
4. radius/shadow는 스크린샷 근거 없으면 `unknown` (날조 금지).

## Step 4 — 화면 순회
1. 위에서 아래, 왼쪽→오른쪽 순으로 요소 나열.
2. 가로 스크롤 리스트는 첫 카드·gap·peek(다음 카드 노출 px)까지 측정.
3. 탭/바텀 네비게이션이 있으면 각 탭 화면으로 이동해 동일 파이프라인 반복.
4. 모달/바텀시트/토스트는 트리거 후 별도 섹션으로 측정.

# 식별자 규칙 (identify)
우선순위:
1. `role` + 보이는 `text`
2. `aria-label` 부분 일치 (`label*=...`)
3. 부모 섹션명 + 상대 위치(nth)
4. (최후) 측정 당시 node id — `unstable-id`로 표기

예:
- `role=button / text="카카오로 시작하기"`
- `role=group / label*="희망토농장"`
- `section=새로들어왔어요 / nth-card=1`

# 출력 포맷 (이 형식만, 파일: {OUTPUT_PATH})

## 0. 측정 메타
- url
- viewport (w×h), dpr
- framework: flutter-canvaskit | html-dom
- semantics: on | off
- 측정 시각 (ISO)
- raw dump 첨부 여부

## 1. Design Tokens
반복되는 값만 토큰화한다. 1회성 값은 토큰에 넣지 않는다.

```yaml
color:
  primary: "#RRGGBB"      # 근거: [섹션]
  on-primary: "#RRGGBB"
  background: "#RRGGBB"
  surface: "#RRGGBB"
  text-primary: "#RRGGBB"
  text-secondary: "#RRGGBB"
  accent: "#RRGGBB"
  border: "#RRGGBB"
space:
  page-x: N
  section-y: N
  card-gap-x: N
  card-gap-y: N
radius:
  card: N | unknown
  button: N | unknown
  badge: N | unknown
type:
  display:
    size: N
    weight: Bold|Medium|Regular|unknown
  title:
    size: N
    weight: ...
  body:
    size: N
    weight: ...
  caption:
    size: N
    weight: ...
elevation:
  card: none | unknown | {blur, y, color, opacity}
```

## 2. 페이지 스펙 — [페이지명] `[경로]`

각 요소:

```
N. [요소명]
   identify: ...
   box: x=.. y=.. w=.. h=..
   spacing:
     parent: [부모명 | viewport]
     inset: top=.. right=.. bottom=.. left=..
     gap_to_prev: N | null
   visual:
     bg: "#......" | transparent | image:[설명]
     fg: "#......" | null
     radius: N | unknown
     shadow: none | unknown | {blur, y, color, opacity}
   typography: (텍스트면)
     content: "..."
     size: N | unknown
     weight: ...
     lineHeight: N | unknown
     align: left|center|right|unknown
   behavior: [탭/스크롤/네비 동작]
   states: default | selected | disabled | ...
   notes: [클리핑, 오버랩, 측정 한계]
```

큰 블록(카드/리스트/폼)은 하위에 `N.1`, `N.2`로 자식 요소를 펼친다.

## 3. 섹션 레이아웃 요약
- 세로 스택: `[헤더 h=..] → gap=.. → [히어로 h=..] → ...`
- 가로 리스트: `item.w=.., gap=.., padding-left=.., peek=..`
- 고정 영역: header / bottom-nav 의 height와 content safe area

## 4. 재현 체크리스트
- [ ] page horizontal inset == 토큰 `space.page-x`
- [ ] header height
- [ ] bottom nav height / item 균등 분할
- [ ] 카드 width / gap / peek
- [ ] 주요 텍스트 줄수·말줄임
- [ ] 주요 색상 hex 일치
- [ ] CTA 버튼 size / inset

## 5. 미확정 / 한계
측정 불가 항목을 명시한다. 예: canvas 위 exact border-radius, blur shadow alpha, font-family 파일명.

## 6. React 컴포넌트 후보 (사람 검수용) — 파일: {COMPONENT_REVIEW_PATH}

목표 서비스를 React로 재현할 때 참고할 **후보**만 만든다.  
**자동 합치기 금지.** 동일/유사 여부는 측정값으로 분류하고, `decision`은 항상 `pending`으로 둔다.

### 6.1 분류 규칙
측정된 요소끼리 비교해 다음 중 하나로만 표기한다.

| status | 의미 | AI가 해도 되는 일 | AI가 하면 안 되는 일 |
|---|---|---|---|
| `identical` | box/spacing/visual/typography 구조가 측정값 기준으로 동일 (콘텐츠 텍스트·이미지만 다름) | 같은 `candidateName`으로 묶기 제안 | 파일을 하나로 구현해 버리기 |
| `similar` | 역할은 같으나 size/inset/gap/type/radius 중 **1개 이상 수치 차이** | 차이표 + 합치기/분리/variant 옵션 제시 | 차이를 무시하고 하나로 단정 |
| `distinct` | 역할·구조가 다름 | 별도 후보로 유지 | 억지 추상화 |

`identical`이어도 사람 확인 전 `decision: pending`을 유지한다.

### 6.2 각 후보 항목 포맷

```
### C-N. [candidateName]   예: ProductCard, BottomNav, SectionHeader
status: identical | similar | distinct
decision: pending   # merge | variant | split | reject — 사람만 기입
suggested_react: [ComponentName]
suggested_props: [예: title, imageUrl, price, badge?, selected?]
suggested_tokens: [space.page-x, color.text-primary, ...]
preview:
  file: previews/C-N-[candidateName].png   # {PREVIEW_DIR} 기준 상대경로
  source_url: [캡처한 페이지 URL]
  crop_box: x=.. y=.. w=.. h=..            # 뷰포트 기준 CSS px
  alt: "[컴포넌트 명이 보이는 장면 한 줄 설명]"
instances:
  - page: [/] section: [새로 들어왔어요] element: [N]
  - page: [/] section: [인기] element: [M]
diff:   # similar일 때 필수. identical이면 none
  - field: [w | inset.left | type.size | ...]
    a: [값] (@instance)
    b: [값] (@instance)
options_for_reviewer:   # similar일 때 필수
  1. merge: 차이를 무시/평균 — 비권장 사유 있으면 적기
  2. variant: prop으로 분기 (예: size="sm"|"md")
  3. split: 별도 컴포넌트 유지
reviewer_note: ""   # 사람이 채움
```

`preview.file`이 없거나 이미지가 깨지면 해당 후보는 미완성이다.

### 6.3 React 이관 가이드 (구현은 검수 후)
검수자가 `decision`을 채운 뒤에만 적용한다.

1. **Tokens first**: 섹션 1 토큰을 CSS variables / theme 객체로 옮긴다.
2. **One decision → one module**:
   - `merge` / `identical` 확정 → 단일 컴포넌트 + props로 콘텐츠만 주입
   - `variant` → 단일 컴포넌트 + `variant`/`size` prop, 분기별 수치를 토큰 또는 variant map에 고정
   - `split` → 파일/컴포넌트 분리, 공통은 더 작은 primitive만 공유
3. **수치 하드코딩 위치**: 컴포넌트 내부 magic number 금지. 토큰 또는 variant map만.
4. **페이지 조립**: 페이지는 레이아웃+데이터 연결만. 픽셀 스펙은 컴포넌트/토큰에 둔다.
5. **검수 전 금지**: 후보를 합친 채 구현, 차이 평균내기, “거의 같으니 하나로” 판단.

### 6.4 검수 체크리스트 (사람용)
- [ ] `identical` 묶음이 정말 수치 동일한지 인스턴스별 diff 재확인
- [ ] `similar` 항목마다 merge / variant / split 중 하나 선택
- [ ] 선택한 decision을 표에 기입 (`pending` 제거)
- [ ] 카탈로그에서 컴포넌트 명 + 미리보기 이미지가 모두 보이는지 확인
- [ ] 확정된 후보만 React 구현 착수

## 7. 웹 디자인 시스템 카탈로그 — {CATALOG_PATH}

브라우저에서 바로 열어 **컴포넌트별로 이름과 실제 생김새**를 확인할 수 있는 정적 HTML을 만든다.
빌드 도구·Storybook·서버 없이 `{CATALOG_PATH}` 파일을 더블클릭/브라우저 오픈만으로 동작해야 한다.

### 7.1 미리보기 이미지 규칙 ({PREVIEW_DIR})
1. 뷰포트 {VIEWPORT_WIDTH}×{VIEWPORT_HEIGHT}에서 원본 페이지를 캡처한다.
2. 해당 컴포넌트의 Semantics `box`(x,y,w,h)로 **크롭**한다. (전체 페이지만 넣고 끝내지 말 것)
3. 파일명: `C-N-[candidateName].png` (예: `C-3-ProductCard.png`)
4. `similar`이고 생김새가 눈에 띄게 다르면 인스턴스별 추가 컷을 허용: `C-N-[name]--a.png`, `--b.png`
5. 이미지는 **원본 사이트 실화면**이어야 한다. AI 재생성·목업·스케치 금지.
6. 배경이 잘리면 컴포넌트 주변 8~16px만 여백으로 포함해도 된다. 다른 컴포넌트가 화면을 지배하면 안 된다.

### 7.2 카탈로그 UI 필수 요소
페이지 상단:
- 제목: `Design System Catalog`
- 출처 URL, viewport, 측정일

토큰 요약(선택, 짧게):
- color swatch (hex + 이름)
- space / type 주요 값

컴포넌트 그리드/리스트 — **각 카드마다 필수**:
1. **컴포넌트 명** (`candidateName` / `suggested_react`) — 큰 제목
2. **실제 웹 생김새** — `<img src="previews/..." alt="...">` (위 미리보기)
3. status 뱃지: identical | similar | distinct
4. decision 뱃지: pending (검수 후 사람이 바꿔도 됨)
5. 짧은 메타: source path/section, box w×h, 주요 tokens
6. (similar) diff 요약 1~3줄

카드 클릭 또는 앵커(`#C-N`)로 해당 카드로 스크롤 가능해야 한다.
좌측 또는 상단에 **컴포넌트 명 목차(네비)** 를 두고, 클릭 시 해당 카드로 이동한다.

### 7.3 HTML 뼈대 (이 구조를 따를 것)

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Design System Catalog</title>
  <style>
    /* 읽기 쉬운 단순 레이아웃. 디자인 시스템 자체를 꾸미는 것이 목적이 아님 */
    :root { --page: #fff; --ink: #111; --muted: #666; --line: #e5e5e5; --bg: #f6f6f6; }
    body { margin: 0; font-family: system-ui, sans-serif; color: var(--ink); background: var(--bg); }
    .wrap { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
    nav { position: sticky; top: 0; align-self: start; height: 100vh; overflow: auto; background: #fff; border-right: 1px solid var(--line); padding: 16px; }
    nav a { display: block; padding: 6px 0; color: var(--ink); text-decoration: none; font-size: 14px; }
    main { padding: 24px; }
    header.page { margin-bottom: 24px; }
    .meta { color: var(--muted); font-size: 13px; }
    .tokens { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 28px; }
    .swatch { width: 56px; }
    .swatch i { display: block; height: 32px; border: 1px solid var(--line); border-radius: 6px; }
    .grid { display: grid; gap: 20px; }
    article.card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
    article.card h2 { margin: 0 0 8px; font-size: 20px; }
    .badges span { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #eee; margin-right: 6px; }
    .preview { margin: 12px 0; background: var(--bg); border-radius: 8px; padding: 12px; text-align: center; }
    .preview img { max-width: 100%; height: auto; image-rendering: auto; }
    .meta-list { font-size: 13px; color: var(--muted); }
    @media (max-width: 800px) { .wrap { grid-template-columns: 1fr; } nav { height: auto; position: relative; } }
  </style>
</head>
<body>
  <div class="wrap">
    <nav>
      <strong>Components</strong>
      <!-- 반복: <a href="#C-N">ComponentName</a> -->
    </nav>
    <main>
      <header class="page">
        <h1>Design System Catalog</h1>
        <p class="meta">source: {TARGET_URL} · viewport: {VIEWPORT_WIDTH}×{VIEWPORT_HEIGHT} · measured: [ISO]</p>
      </header>
      <!-- tokens 요약 (선택) -->
      <section class="grid">
        <!-- 반복: article.card#C-N -->
        <article class="card" id="C-1">
          <h2>ProductCard</h2>
          <div class="badges">
            <span>status: identical</span>
            <span>decision: pending</span>
          </div>
          <div class="preview">
            <img src="previews/C-1-ProductCard.png" alt="ProductCard 원본 화면 크롭" />
          </div>
          <div class="meta-list">
            w×h: 150×267 · tokens: space.page-x, type.caption · page: /
          </div>
        </article>
      </section>
    </main>
  </div>
</body>
</html>
```

상대경로 `previews/` 는 `{CATALOG_PATH}` 기준 `{PREVIEW_DIR}`를 가리키도록 둔다.
외부 CDN·폰트·프레임워크 의존 금지(오프라인·로컬 오픈 가능).

### 7.4 카탈로그 완료 조건
- [ ] `{CATALOG_PATH}`를 브라우저로 열면 레이아웃이 보인다
- [ ] 목차의 모든 컴포넌트 명이 카드 제목과 1:1로 대응한다
- [ ] 모든 카드에 **깨지지 않는** 미리보기 이미지가 있다
- [ ] 미리보기는 원본 웹 캡처 크롭이다 (설명 텍스트만으로 대체 금지)
- [ ] `#C-N` 앵커 이동이 동작한다

# 품질 기준 (하나라도 실패 시 재작업)
- [ ] box/spacing이 모두 정수 px이거나 명시적 `unknown`
- [ ] 계산식 근거(부모/형제 좌표)가 있거나 raw dump로 추적 가능
- [ ] “약/정도/비슷” 표현 0개
- [ ] identify에 불안정 node id만 쓰지 않음
- [ ] viewport가 {VIEWPORT_WIDTH}×{VIEWPORT_HEIGHT}로 고정된 채 측정됨
- [ ] 스크린샷이 색·라디우스 근거로 남아 있음
- [ ] 컴포넌트 후보의 `decision`이 전부 `pending` (AI가 merge로 단정하지 않음)
- [ ] `similar` 항목에 diff + options_for_reviewer 3안이 있음
- [ ] `{CATALOG_PATH}`가 로컬 브라우저에서 열리고, 카드마다 컴포넌트 명 + 미리보기 이미지가 있음
- [ ] 모든 `preview.file`이 `{PREVIEW_DIR}`에 실재함

# 작업 지시
1) {TARGET_URL} 부터 측정한다.
2) 홈 → (있으면) 바텀탭/주요 IA 순으로 동일 파이프라인을 반복한다.
3) 페이지 스펙을 {OUTPUT_PATH}에 작성한다.
4) 컴포넌트 후보를 {COMPONENT_REVIEW_PATH}에 작성한다. decision은 모두 pending. 각 항목에 preview 메타를 채운다.
5) 각 후보의 원본 화면을 크롭해 {PREVIEW_DIR}에 저장한다.
6) {CATALOG_PATH} HTML 카탈로그를 생성한다. 목차 + (컴포넌트 명 + 미리보기) 카드를 모두 넣는다.
7) 브라우저로 카탈로그를 열어 이미지 깨짐·이름 누락이 없는지 확인한다.
8) raw Semantics JSON은 별도 첨부하거나 문서 하단에 `<details>`로 넣는다.
9) React 코드 작성은 사람이 섹션 6을 검수·decision 기입한 뒤에만 한다.
````

---

## 부록 A — 일반 HTML/DOM 사이트용 (Flutter가 아닐 때)

Flutter가 아니면 아래를 본문 Step 1~2 대신 사용한다.

```js
(() => {
  const pick = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: el.className?.toString?.()?.slice?.(0, 120) || null,
      text: (el.innerText || '').trim().slice(0, 80),
      box: {
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
      },
      margin: {
        top: cs.marginTop, right: cs.marginRight,
        bottom: cs.marginBottom, left: cs.marginLeft,
      },
      padding: {
        top: cs.paddingTop, right: cs.paddingRight,
        bottom: cs.paddingBottom, left: cs.paddingLeft,
      },
      gap: cs.gap || cs.columnGap || null,
      font: {
        size: cs.fontSize,
        weight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        family: cs.fontFamily,
        color: cs.color,
      },
      bg: cs.backgroundColor,
      radius: cs.borderRadius,
      shadow: cs.boxShadow,
      display: cs.display,
      position: cs.position,
    };
  };

  // 사용 예: 주요 요소 selector 목록을 넣어 실행
  const selectors = [
    'header', 'nav', 'main', 'footer',
    // TODO: 페이지별 핵심 selector
  ];
  return {
    meta: { url: location.href, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio },
    elements: selectors.map((s) => ({ selector: s, ...(document.querySelector(s) ? pick(document.querySelector(s)) : { missing: true }) })),
  };
})();
```

문서의 `spacing`에는 computed `margin`/`padding`/`gap`을 그대로 쓰고,  
`identify`에는 안정적인 CSS selector + 보이는 텍스트를 쓴다.

---

## 부록 B — 형제 gap 일괄 계산 헬퍼

Semantics dump의 `nodes` 배열에 대해, 같은 행(유사 y)인 카드들의 gap을 구할 때:

```js
function gapsX(items, yTolerance = 4) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (Math.abs(cur.y - prev.y) > yTolerance) continue;
    out.push({
      from: prev.text || prev.label || prev.id,
      to: cur.text || cur.label || cur.id,
      gap: cur.x - prev.right,
    });
  }
  return out;
}
```

---

## 부록 C — 직팜 빠른 시작 체크

1. 뷰포트 390×844로 `https://www.zikfarm.com/` 연다.
2. Semantics ON.
3. 프롬프트 본문 Step 1 스크립트 실행 → raw 저장.
4. 헤더 / 히어로 / 섹션 타이틀 / 가로 상품 리스트 / 바텀탭부터 스펙 작성.
5. 바텀탭(홈·리뷰·주문내역·내 정보) 순회.
6. 컴포넌트별 크롭 미리보기를 `design-spec/catalog/previews/`에 저장.
7. `design-spec/catalog/index.html` 생성 후 브라우저로 열어 이름·이미지 확인.
8. 품질 기준 체크리스트 통과 후 제출.

### 측정 시 참고 (값이 아님 — 반드시 재측정)

과거 넓은 뷰포트에서 관찰된 **패턴**일 뿐, 문서에 그대로 쓰지 말 것.

- 좌우 page inset이 약 18~20 근처로 반복될 수 있음
- 바텀탭이 균등 분할되는 경향
- 가로 상품 카드 + 고정 gap + 우측 peek 패턴

---

## 부록 D — 사람 검수 흐름 (합칠지 말지)

```
측정 스펙 ({OUTPUT_PATH})
        ↓
컴포넌트 후보 ({COMPONENT_REVIEW_PATH}) + 미리보기 PNG
        ↓
웹 카탈로그 ({CATALOG_PATH})
  ← 브라우저에서 컴포넌트 명 + 실물 생김새 확인
        ↓
사람이 카탈로그/diff 보고 decision 기입
  merge | variant | split | reject
        ↓
확정된 것만 React 컴포넌트 구현
```

- **identical**: 수치 동일 → 보통 한 컴포넌트 + props. 그래도 검수 후 확정.
- **similar**: 수치가 다름 → merge(비권장)·variant·split 중 사람이 선택.
- **distinct**: 처음부터 별도 컴포넌트.

검수 시 카탈로그에서 확인할 것:
1. 왼쪽/상단 목차의 **컴포넌트 명**
2. 카드 안 **원본 웹 크롭 이미지**가 그 이름과 맞는지
3. similar면 차이 컷이 충분한지

---

## 부록 E — 카탈로그 로컬 열기

```bash
# 예: 산출물 폴더에서
open design-spec/catalog/index.html
# 또는
python3 -m http.server 8765 --directory design-spec/catalog
# → http://localhost:8765/
```

`file://`로 열어도 상대경로 이미지가 보이도록 `index.html`과 `previews/`를 같은 카탈로그 폴더에 둔다.

---

## 변경 이력

| 날짜 | 내용 |
|---|---|
| 2026-10-17 | 초안. Flutter CanvasKit Semantics bbox 역산 통합본 |
| 2026-10-17 | React 컴포넌트 후보·사람 검수(decision pending) 섹션 추가 |
| 2026-10-17 | 웹 카탈로그(컴포넌트 명 + 실물 미리보기) 산출 규칙 추가 |
