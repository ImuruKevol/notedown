# 저장소 작업 렌더 갱신 및 깊은 문서 가져오기 기본 활성화

## 요청

리뷰 ID `oywmjfzkcdypkjpyjvlguavbzkhmvxdf`의 후속 요청. `metadata 생성/갱신`, `상태 새로고침`, `깊은 문서 가져오기` 버튼에 `service.render`가 연결되지 않아 화면 상태가 갱신되지 않는 문제를 보완하고, `깊은 경로 Markdown 가져오기` 토글은 제거하며 `깊은 문서 가져오기` 버튼은 기본 활성화해달라는 요청.

## 변경 파일

- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`
- `devlog.md`
- `devlog/2026-05-29/006-storage-render-deep-import-default.md`

## 변경 내용

- 설정 화면 컴포넌트에 WIZ `Service`를 주입했다.
- 저장소 작업 시작과 종료, Electron 저장소 API 미지원 fallback 상태 변경 뒤에 `service.render()`를 호출하도록 했다.
- 디렉토리 선택 액션도 선택 창 표시/종료 상태가 즉시 반영되도록 렌더 호출을 추가했다.
- `깊은 경로 Markdown 가져오기` 토글 UI와 `settings.importDeepMarkdown` 설정값을 제거했다.
- `깊은 문서 가져오기` 버튼을 `storageBusy` 상태만 기준으로 비활성화하도록 바꿔 기본 활성 상태로 노출했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009/settings`가 `200 OK`로 응답하는 것을 확인했다.
- `settings.importDeepMarkdown`, `toggleDeepImport`, `깊은 경로 Markdown 가져오기` 문자열이 설정 화면 소스에서 제거된 것을 확인했다.
- 저장소 작업 소스에 `service.render()` 호출과 `importDeepMarkdown: true/false` 실행 옵션이 남아 있는 것을 확인했다.

## 남은 리스크

- 인앱 Browser `iab`가 현재 사용 가능한 브라우저 세션을 노출하지 않아 실제 버튼 클릭 검증은 수행하지 못했다.
