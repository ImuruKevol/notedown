# 동기화 충돌 상태 판정 및 충돌 뷰어 연결

## 요청

ReviewOps `xbyheezgknlyegsiclrqtcoobtbagpte` - 앱 시작 시 사이드바 왼쪽 아래에는 동기화 완료라고 표시되지만 설정 동기화 화면에는 충돌 1건이 표시되고 수정 사항이 반영되지 않는다. 충돌이 있으면 충돌 상태로 표시해야 하며, 충돌 뷰어 또는 에디터를 띄워야 하는데 현재 연결되어 있지 않다.

## 변경 파일

- `electron/main.cjs`
- `electron/preload.cjs`
- `src/app/page.notes/view.ts`
- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`
- `src/app/component.nav.sidebar/view.ts`
- `src/app/component.nav.sidebar/view.pug`
- `devlog.md`
- `devlog/2026-06-01/003-sync-conflict-viewer.md`

## 변경 내용

- 시작 동기화 결과 저장 시 `summary.conflicts`, `plan.conflicts`, `operations.conflicts` 중 하나라도 있으면 `status: conflict` 및 `ok: false`로 저장하도록 했다.
- 사이드바 하단 상태 표시도 저장된 충돌 수를 우선 판정해 "동기화 완료" 대신 "동기화 충돌"을 표시하도록 했다.
- 사이드바 하단 동기화 상태 표시를 설정 화면 링크로 바꿔 충돌 확인 진입점을 만들었다.
- 설정 화면에서 시작 동기화 충돌을 감지하면 동기화 섹션을 자동으로 열고 충돌 뷰어를 표시하도록 했다.
- 설정 동기화 화면에 충돌 목록, 서버 버전, 로컬 버전 readonly 에디터를 추가했다.
- Electron IPC에 `notedown:sync:read-file`을 추가해 충돌 파일의 서버/로컬 내용을 읽어 뷰어에 표시하도록 했다.

## 검증

- `node --check project/main/electron/main.cjs && node --check project/main/electron/preload.cjs` 성공.
- `wiz_project_build(clean=false)` 성공.
- VM 기반 mock으로 `readSyncConflictFile`이 서버 base64 본문과 로컬 Markdown 본문을 함께 반환하는 것을 확인했다.
- `curl http://172.16.0.143:5500/api/health` 결과 `{"status":"ok"}` 확인.
- `http://172.16.0.143:5500/openapi.json`에서 `/api/sync/plan`, `/api/sync/file`, `/api/files/{relative_path}` 존재를 확인했다.
- `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009` 요청 시 200 OK 및 최신 `Last-Modified: Mon, 01 Jun 2026 06:11:36 GMT` 응답을 확인했다.
- 수정 파일의 trailing whitespace 및 conflict marker 검색 결과 없음.
