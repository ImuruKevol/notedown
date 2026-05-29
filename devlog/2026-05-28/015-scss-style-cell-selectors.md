# SCSS형 문서 스타일과 셀 타입 선택자 지원

## 요청

리뷰 ID `jsevvorameczakitpwsyezqsmlkcabxj`의 후속 요청. `:::` 스타일 블럭 안에 root 선언과 `table { color: red; }` 같은 SCSS/CSS selector rule을 함께 입력해도 스타일이 적용되게 하고, 각 셀 타입에 별도 스타일을 줄 수 있도록 설계해 구현해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-28/015-scss-style-cell-selectors.md`

## 변경 내용

- 스타일 블럭 파서를 root 선언과 selector rule로 분리하도록 확장했다.
- `table { ... }`, `.cell-code { ... }`, `& table { ... }` 같은 one-level SCSS/CSS selector rule을 지원하고, Preview/PDF 양쪽에 scope된 CSS로 주입하도록 했다.
- selector rule 안의 선언도 기존 방식처럼 `!important`를 자동 보강하고, `color` rule은 하위 텍스트 요소가 부모 color를 강제 상속하도록 추가 rule을 생성했다.
- 구역별 스타일 rule 적용을 위해 divider 구역마다 `notedown-style-section-{id}` class를 Preview row와 PDF section wrapper에 부여했다.
- 셀 타입별 스타일 타겟팅을 위해 Preview/PDF에 `cell-table`, `cell-code`, `cell-quote`, `cell-divider`, `cell-task`, `cell-heading`, `cell-list`, `cell-text`, `cell-blank` 계열 class를 부여했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `git diff --check -- src/app/page.notes/view.ts src/app/page.notes/view.pug src/angular/styles/styles.scss` 성공
- TypeScript 소스를 transpile한 스모크 테스트로 root 선언 보존, selector rule scope 생성, `table` color inheritance rule 생성, `.cell-code` selector 지원, Preview cell class 부여, PDF section class 생성을 확인했다.
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009/notes`가 `200 OK`로 응답하는 것을 확인했다.

## 남은 리스크

- 인앱 Browser `iab`가 계속 사용 불가 상태라 실제 화면 조작 검증은 수행하지 못했다.
- selector parser는 one-level CSS/SCSS block을 대상으로 하며, 중첩 rule이나 `@media` 같은 at-rule은 아직 지원하지 않는다.
