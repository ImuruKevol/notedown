# 충돌 diff 레이아웃 수정 및 서버/로컬 버전 적용 UI 추가

## 요청

ReviewOps `xbyheezgknlyegsiclrqtcoobtbagpte` - 첨부 스크린샷처럼 diff editor가 이상하게 들어가 있고 스크롤바가 중복되는 등 레이아웃이 올바르지 않다. 각 충돌 사항에 대해 서버/로컬 중 어떤 버전을 사용할지 선택하고, 선택한 버전으로 동기화할 수 있는 UI가 필요하다.

## 변경 파일

- `electron/main.cjs`
- `electron/preload.cjs`
- `src/app/page.notes/view.ts`
- `src/app/page.notes/view.pug`
- `devlog.md`
- `devlog/2026-06-01/005-sync-conflict-resolve-actions.md`

## 변경 내용

- 노트 화면 충돌 diff 영역의 고정 최소 높이를 제거하고, diff host를 컨테이너에 absolute fill로 배치해 외부 스크롤과 Monaco 내부 스크롤이 겹치지 않도록 했다.
- Monaco diff editor가 좁은 폭에서 inline view로 접히지 않도록 `useInlineViewWhenSpaceIsLimited: false`를 설정하고, overview ruler를 꺼서 불필요한 보조 스크롤/레일을 줄였다.
- 충돌 화면 상단에 `서버 버전 사용`/`로컬 버전 사용` segmented control과 `선택 버전 적용` 버튼을 추가했다.
- `notedown:sync:resolve-conflict` IPC를 추가했다.
- 서버 버전 적용 시 서버 파일을 로컬 저장소에 내려받고 metadata/sync state를 갱신한 뒤 남은 동기화 계획을 다시 계산하도록 했다.
- 로컬 버전 적용 시 현재 서버 revision을 `lastKnownRevision`으로 사용해 로컬 파일을 서버에 업로드하고 남은 동기화 계획을 다시 계산하도록 했다.

## 검증

- `node --check electron/main.cjs && node --check electron/preload.cjs` 성공.
- `wiz_project_build(clean=false)` 성공.
- `git diff --check` 성공.
- `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009` 요청 시 200 OK 및 최신 `Last-Modified: Mon, 01 Jun 2026 06:52:22 GMT` 응답을 확인했다.
- `rg`로 `resolveConflict`, `resolveSyncConflict`, `useInlineViewWhenSpaceIsLimited`, `선택 버전 적용` 연결을 확인했다.
- 수정 대상 파일의 conflict marker 검색 결과 없음.
