# 문서 내부 글로벌/구역별 스타일 지시문 추가

## 요청

리뷰 ID `jsevvorameczakitpwsyezqsmlkcabxj`의 "스타일 부여 기능 추가" 요청. "작업 시작해줘. 구역별 스타일과 함께 문서 내부에 글로벌 스타일 정의도 별도로 할 수 있으면 좋을 것 같아."라는 요청에 따라 Markdown 문서 내부에서 전역 CSS와 구역별 스타일을 정의할 수 있도록 개선했다.

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-28/012-document-style-directives.md`

## 변경 내용

- Markdown 본문에서 `notedown-style`, `global-style`, `global-css`, `style` fenced block을 문서 글로벌 CSS로 파싱하도록 추가했다.
- `::: section class="..." style="..."` / `:::` 구문과 `<!-- @section ... -->` comment 구문을 구역 스타일 지시문으로 처리하도록 추가했다.
- 스타일 지시문은 Preview 본문에서 숨기고, Preview에는 문서 컨테이너로 scope된 CSS와 구역 row class/style을 적용하도록 했다.
- PDF HTML 생성 시 동일한 파서 결과를 사용해 글로벌 CSS는 `<style>`에 주입하고, 구역은 `notedown-doc-section` wrapper로 출력하도록 했다.
- 슬래시 자동완성에 `Global style`, `Styled section` 스니펫을 추가했다.
- 구역 스타일이 적용된 Preview row의 라인번호가 스타일 색상을 자연스럽게 상속하도록 보조 CSS를 추가했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `git diff --check -- src/app/page.notes/view.ts src/app/page.notes/view.pug src/angular/styles/styles.scss` 성공
- TypeScript 소스를 transpile한 스모크 테스트로 글로벌 CSS 파싱, Preview CSS scope, 구역 class/style 적용, PDF wrapper 생성, 지시문 숨김 처리를 확인했다.
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009/notes`가 `200 OK`로 응답하는 것을 확인했다.
- 인앱 Browser 세션은 `iab`가 사용 불가해 실제 화면 조작 검증은 수행하지 못했다.
