# 서버 동기화 토큰 유효 시간 제거

## 요청

ReviewOps `aidnaojehibaqbvjhbtlxcoiakmoxbuv` - 서버 동기화 시 유효 시간이 있는데, 한 번 동기화하면 굳이 유효 시간을 둘 필요가 없으므로 유효 시간을 완전히 제거해달라는 요청.

## 변경 파일

- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`
- `src/app/page.notes/view.ts`
- `src/app/component.nav.sidebar/view.ts`
- `devlog.md`
- `devlog/2026-06-01/001-remove-sync-token-expiry.md`

## 변경 내용

- 설정 모델에서 `syncTokenExpiresAt` 필드를 제거하고, 로그인 토큰 저장 시 서버의 `expiresIn` 값을 더 이상 저장하지 않도록 했다.
- 로그인 여부 판단을 token 존재 여부만 보도록 변경했다.
- 시작 동기화, 저장 시 자동 업로드, 사이드바 생성/삭제 동기화에서 token 만료 시간 검사를 제거했다.
- 설정 - 동기화 화면의 token 만료 표시를 제거했다.

## 검증

- `rg -n "syncTokenExpiresAt|expiresIn|expires|expiry|만료|syncTokenExpiryLabel" src/app electron` 결과 앱 코드에서 만료 관련 참조가 없음을 확인했다.
- `git diff --check -- src/app/page.settings/view.ts src/app/page.settings/view.pug src/app/page.notes/view.ts src/app/component.nav.sidebar/view.ts` 성공.
- `node --check electron/main.cjs && node --check electron/preload.cjs` 성공.
- `wiz_project_build(clean=false)` 성공.
- `curl http://172.16.0.143:5500/api/health` 결과 `{"status":"ok"}` 확인.
- 요청 링크 `http://172.16.0.143:3009/settings`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함한 HTTP 검증에서 200 OK 및 최신 빌드 산출물 응답을 확인했다.
