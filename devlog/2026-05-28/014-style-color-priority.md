# 문서 스타일 color 우선순위 보강

## 요청

리뷰 ID `jsevvorameczakitpwsyezqsmlkcabxj`의 후속 요청. `background`, `border` 등은 적용되지만 `color` CSS가 `!important`를 붙여도 적용되지 않고 있어, 스타일 블럭에 CSS 방식으로 작성한 모든 스타일이 우선적으로 적용되도록 해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-28/014-style-color-priority.md`

## 변경 내용

- 스타일 선언을 정규화할 때 `!important`가 없는 선언에는 자동으로 `!important`를 추가해 inline 스타일 우선순위를 높였다.
- 글로벌/구역 스타일에 `color:` 선언이 포함된 경우 `has-text-style` 상태를 기록하도록 파서를 보강했다.
- Preview 글로벌 컨테이너와 구역 row에 `has-text-style` class를 붙이고, Markdown typography/link/headings 요소가 부모 color를 `!important`로 상속하도록 CSS를 추가했다.
- PDF 출력에서도 `content has-text-style`, `notedown-doc-section has-text-style` class를 붙이고 하위 텍스트 요소가 부모 color를 강제 상속하도록 HTML 내 CSS를 보강했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `git diff --check -- src/app/page.notes/view.ts src/app/page.notes/view.pug src/angular/styles/styles.scss` 성공
- TypeScript 소스를 transpile한 스모크 테스트로 글로벌/구역 `color` 감지, `!important` 자동 부여, 기존 `!important` 보존, PDF `has-text-style` wrapper 생성을 확인했다.
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009/notes`가 `200 OK`로 응답하는 것을 확인했다.

## 남은 리스크

- 인앱 Browser `iab`가 계속 사용 불가 상태라 실제 화면 조작 검증은 수행하지 못했다.
