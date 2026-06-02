# 서버 동기화 기능 추가

## 요청

ReviewOps `aidnaojehibaqbvjhbtlxcoiakmoxbuv` - `http://172.16.0.143:5500/api/docs`, `http://172.16.0.143:5500/openapi.json` 문서를 참고해 앱에 서버 동기화 기능을 추가해달라는 요청. 전체 동기화는 메타데이터를 먼저 비교해 업로드/다운로드/삭제/충돌 대상을 판단하고, 이후 앱에서 파일 단위로 업로드하는 흐름이어야 하며, 개별 동기화는 파일 저장 이벤트에서 파일과 워크스페이스 정보를 서버에 업로드하는 방식이어야 한다.

## 변경 파일

- `electron/main.cjs`
- `electron/preload.cjs`
- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`
- `src/app/page.notes/view.ts`
- `src/app/component.nav.sidebar/view.ts`
- `devlog.md`
- `devlog/2026-05-29/013-server-sync.md`

## 변경 내용

- Electron 메인 프로세스에 동기화 서버 HTTP 브리지를 추가하고 `/api/health`, `/api/setup`, `/api/login`, `/api/sync/plan`, `/api/sync/file`, `/api/files/{relative_path}` 호출을 IPC로 노출했다.
- 로컬 `metadata.json`과 `.notedown-sync.json` 상태를 기준으로 서버 메타데이터와 비교할 `knownFiles`, revision, file hash 정보를 구성하도록 했다.
- 전체 동기화에서 충돌이 있으면 자동 적용하지 않고, 충돌이 없으면 다운로드/로컬 삭제/업로드/서버 삭제를 파일 단위로 처리하도록 했다.
- 설정 화면에 동기화 섹션을 추가해 서버 URL, 초기 설정, 로그인, 동기화 계획 확인, 전체 동기화, 저장 시 업로드 옵션을 제어할 수 있게 했다.
- 노트 저장 및 사이드바의 생성/삭제 흐름에서 저장 시 업로드 옵션이 켜져 있으면 개별 파일 동기화가 실행되도록 연결했다.

## 검증

- 동기화 서버 문서 `http://172.16.0.143:5500/openapi.json` 및 Swagger HTML 구조를 확인했다.
- `curl http://172.16.0.143:5500/api/health` 결과 `{"status":"ok"}` 확인.
- `curl http://172.16.0.143:5500/api/setup/status` 결과 서버가 이미 file 기반으로 configured 상태임을 확인.
- `node --check electron/main.cjs && node --check electron/preload.cjs` 성공.
- `wiz_project_build(clean=false)` 성공.
- `git diff --check -- electron/main.cjs electron/preload.cjs src/app/page.settings/view.ts src/app/page.settings/view.pug src/app/page.notes/view.ts src/app/component.nav.sidebar/view.ts` 성공.
- 요청 링크 `http://172.16.0.143:3009/settings`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함한 HTTP 검증에서 200 OK 및 최신 빌드 산출물 응답을 확인했다.
