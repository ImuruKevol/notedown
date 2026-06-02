# 앱 시작 동기화 및 로그인 상태별 동기화 설정 UX 개선

## 요청

ReviewOps `aidnaojehibaqbvjhbtlxcoiakmoxbuv` - 앱을 처음 켰을 때 저장된 동기화 정보가 있고 로그인 상태라면 서버에서 먼저 metadata를 불러와 서버 metadata와 비교한 뒤 동기화 작업을 진행해야 한다는 요청. 설정 - 동기화 화면은 로그인 여부에 따라 UI가 확실히 달라져야 하는데 현재 동일하게 보여 UX가 좋지 않으므로 개선해달라는 요청.

## 변경 파일

- `electron/main.cjs`
- `src/app/page.notes/view.ts`
- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`
- `devlog.md`
- `devlog/2026-05-29/015-startup-sync-settings-ux.md`

## 변경 내용

- `/notes` 초기화 전에 저장된 서버 URL, token, clientId, storagePath가 유효하면 한 앱 세션당 한 번 `sync.runFull`을 먼저 실행하도록 했다.
- 시작 동기화 결과를 `localStorage`에 기록해 설정 화면에서 최근 시작 동기화 성공/충돌/오류 메시지와 계획 요약을 보여줄 수 있게 했다.
- 동기화 HTTP 요청에 15초 기본 타임아웃을 추가해 시작 동기화가 네트워크 문제로 앱 로딩을 오래 막지 않도록 했다.
- 설정 - 동기화 화면을 로그인 전/후 UI로 분리했다. 로그인 전에는 서버 URL, 사용자 이름, 비밀번호, 연결 확인, 초기 설정, 로그인만 표시하고, 로그인 후에는 연결된 서버/계정/토큰 만료, 연결 확인, 로그아웃, 저장 시 업로드, 계획/전체 동기화만 표시한다.

## 검증

- `node --check electron/main.cjs && node --check electron/preload.cjs` 성공.
- `git diff --check -- electron/main.cjs src/app/page.notes/view.ts src/app/page.settings/view.ts src/app/page.settings/view.pug` 성공.
- `wiz_project_build(clean=false)` 성공.
- `curl http://172.16.0.143:5500/api/health` 결과 `{"status":"ok"}` 확인.
- 요청 링크 `http://172.16.0.143:3009/settings`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함한 HTTP 검증에서 200 OK 및 최신 빌드 산출물 응답을 확인했다.
