# 초기 흰 화면 완화를 위한 부트 셸 및 Monaco 지연 마운트

## 요청

ReviewOps `zfxxldcdyylooleidmoqfsztxbbqnhzf` - 이전 최적화 후에도 앱을 맨 처음 열 때 흰 화면이 너무 오래 유지되므로 추가로 개선해 달라는 요청.

## 변경 파일

- `src/angular/index.pug`
- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `devlog.md`
- `devlog/2026-06-02/006-boot-shell-monaco-deferral.md`

## 변경 내용

- Angular 번들이 실행되기 전에도 흰 화면 대신 Notedown 구조와 유사한 인라인 부트 셸이 즉시 보이도록 `index.pug`에 critical CSS와 skeleton DOM을 추가했다.
- 초기 HTML의 배경/크기/overflow를 inline CSS로 고정해 CSS 번들 로드 전에도 화면이 흰색으로 비지 않도록 했다.
- 노트 화면의 메인 Monaco editor와 코드 preview editor를 첫 렌더 이후에 마운트하도록 `monacoEditorsReady` 플래그를 추가했다.
- Monaco가 아직 마운트되지 않은 짧은 구간에는 에디터 영역 skeleton과 코드블럭 plain fallback을 표시하도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공.
- `node --check project/main/electron/main.cjs && node --check project/main/electron/preload.cjs` 성공.
- `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009` 요청 시 200 OK 및 최신 `Last-Modified: Tue, 02 Jun 2026 02:38:20 GMT` 응답을 확인했다.
- `curl` 응답 HTML에 `.notedown-boot-shell` inline shell과 빌드 스크립트가 포함된 것을 확인했다.
- `rg`로 `monacoEditorsReady` 기반 Monaco 지연 마운트가 `page.notes`에 연결된 것을 확인했다.
- 수정 파일의 conflict marker 및 trailing whitespace 검색 결과 없음.
- Browser 플러그인 검증은 `iab` 브라우저가 제공되지 않아 실행하지 못했다.
