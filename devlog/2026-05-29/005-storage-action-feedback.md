# 저장소 작업 버튼 UX 및 상태 표시 보강

## 요청

리뷰 ID `oywmjfzkcdypkjpyjvlguavbzkhmvxdf`의 후속 요청. `metadata 생성/갱신`, `상태 새로고침` 버튼을 누르면 버튼이 비활성화되고 아무 반응이 없어 UX가 이상하므로, 버그면 고치고 기능이 없으면 기능을 추가하는 등 보완해달라는 요청.

## 변경 파일

- `src/app/page.settings/view.pug`
- `src/app/page.settings/view.ts`
- `devlog.md`
- `devlog/2026-05-29/005-storage-action-feedback.md`

## 변경 내용

- 저장소 작업별 진행 상태(`storageAction`)와 메시지 톤을 추가했다.
- 버튼 실행 즉시 `metadata 생성 중...`, `상태 확인 중...` 같은 진행 라벨을 표시하도록 했다.
- 저장소 메시지를 `aria-live` 영역으로 표시하고 성공/경고/오류 색상을 분리했다.
- Electron 저장소 API가 없는 웹 미리보기에서는 조용히 반환하지 않고 사용 불가 사유와 localStorage 기준 요약 수치를 보여주도록 했다.
- `metadata 생성/갱신`과 깊은 문서 가져오기 성공 결과에 `metadataExists: true`를 반영해 상태 배지가 성공 상태로 바뀌도록 했다.
- 저장소 작업 실패/취소 시 사용자에게 명확한 메시지를 남기도록 했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `git diff --check -- src/app/page.settings/view.ts src/app/page.settings/view.pug` 성공
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009/settings`가 `200 OK`로 응답하는 것을 확인했다.
- 소스와 빌드 산출물에 진행 라벨, `storageMessageClass`, 웹 미리보기 fallback, `metadataExists: true` 보정이 반영된 것을 확인했다.

## 남은 리스크

- 인앱 Browser `iab`가 현재 사용 가능한 브라우저를 노출하지 않아 실제 버튼 클릭 검증은 수행하지 못했다.
