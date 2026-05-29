# Divider 기준 스타일 블럭 문법으로 재정리

## 요청

리뷰 ID `jsevvorameczakitpwsyezqsmlkcabxj`의 후속 요청. 이전 방식이 아니며, 스타일은 코드블럭처럼 backtick 대신 `:::`로 감싼 형태로 작성하고, 구역은 Divider(`---`)를 기준점으로 나뉘는 구역을 뜻한다고 정정했다. 예시는 `:::global ... :::` 글로벌 스타일과 bare `::: ... :::` 구역 스타일이다.

## 변경 파일

- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `src/angular/styles/styles.scss`
- `devlog.md`
- `devlog/2026-05-28/013-divider-style-blocks.md`

## 변경 내용

- 기존 `notedown-style` fenced block 및 명시적 `section class/style` 지시문 중심 처리를 제거하고, `:::global` / bare `:::` 스타일 블럭 파서로 재구성했다.
- `---`, `***`, `___` divider 라인을 구역 경계로 인식하고, bare `:::` 스타일 블럭은 현재 divider 구역 전체에 적용하도록 했다.
- 스타일 블럭 내용은 Preview/PDF 본문에서 숨기고, 글로벌 스타일은 문서 컨테이너에, 구역 스타일은 해당 구역의 Preview row 및 PDF section wrapper에 적용하도록 했다.
- 예시처럼 `border-left 3px solid ...`처럼 colon이 빠진 선언도 `border-left: 3px solid ...;` 형태로 정규화하도록 보강했다.
- 슬래시 자동완성 문구를 `:::global` 및 bare `:::` 문법에 맞게 수정했다.
- PDF 출력에서 divider 라인을 별도 chunk로 처리해 setext heading으로 오인되지 않도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `git diff --check -- src/app/page.notes/view.ts src/app/page.notes/view.pug src/angular/styles/styles.scss` 성공
- TypeScript 소스를 transpile한 스모크 테스트로 `:::global` 파싱, colon 누락 선언 정규화, divider 이후 구역 스타일 적용, divider 미스타일 처리, 지시문 숨김, PDF section wrapper 생성을 확인했다.
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009/notes`가 `200 OK`로 응답하는 것을 확인했다.

## 남은 리스크

- 인앱 Browser 세션은 이전 검증에서 `iab` 사용 불가 상태였기 때문에 실제 화면 조작 검증은 수행하지 못했다.
