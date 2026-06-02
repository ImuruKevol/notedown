# 시작 동기화 상태 표시 및 서버 메타데이터 동기화 보강

## 요청

ReviewOps `xbyheezgknlyegsiclrqtcoobtbagpte` - 앱을 열면 동기화가 진행되어야 하고 성공/실패 여부가 사이드바 왼쪽 하단에 표시되어야 한다. 설정 - 동기화에서 "동기화 계획 확인" 버튼을 제거하고, 서버에서 파일 롤백 및 메타데이터 업데이트 후에도 앱에서 다운로드 0으로 표시되는 전체 동기화 로직을 `http://172.16.0.143:5500/openapi.json` 기준으로 확실히 확인해야 한다.

## 변경 파일

- `electron/main.cjs`
- `src/app/page.notes/view.ts`
- `src/app/page.settings/view.ts`
- `src/app/page.settings/view.pug`
- `src/app/component.nav.sidebar/view.ts`
- `src/app/component.nav.sidebar/view.pug`
- `devlog.md`
- `devlog/2026-06-01/002-startup-sync-status-metadata-reconcile.md`

## 변경 내용

- 시작 동기화 실행 시 `running/success/conflict/error` 결과를 `notedown.sync.startup.result.v1`에 기록하고 `notedown:startup-sync-status` 이벤트로 전파하도록 했다.
- 사이드바 왼쪽 하단에 동기화 상태 점과 "동기화 중/완료/실패/충돌/미설정" 라벨을 표시하도록 했다.
- 설정 - 동기화 화면에서 "동기화 계획 확인" 버튼을 제거하고 전체 동기화만 실행 버튼으로 남겼다.
- `/api/sync/plan` 응답의 서버 metadata와 manifest를 함께 대조해 서버 metadata가 바뀌었는데 파일 계획이 비어 있는 경우에도 다운로드 또는 충돌 계획을 보강하도록 했다.
- 서버 파일 다운로드 URL은 POSIX 경로 segment별 인코딩을 사용하도록 바꿔 하위 폴더 파일 조회 안정성을 높였다.

## 검증

- `node --check project/main/electron/main.cjs && node --check project/main/electron/preload.cjs` 성공.
- `wiz_project_build(clean=false)` 성공.
- 임시 저장소와 mock 서버 metadata/manifest로 `reconcilePlanWithServerMetadata`가 서버 파일 변경을 다운로드 1건으로 보강하고, 로컬 편집이 있는 경우 충돌 1건으로 처리함을 확인했다.
- `curl http://172.16.0.143:5500/api/health` 결과 `{"status":"ok"}` 확인.
- `http://172.16.0.143:5500/openapi.json`에서 `/api/sync/plan`, `/api/sync/file`, `/api/manifest` 존재를 확인했다.
- `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009` 요청 시 200 OK 및 최신 `Last-Modified: Mon, 01 Jun 2026 05:45:42 GMT` 응답을 확인했다.
- 수정 파일의 trailing whitespace 및 conflict marker 검색 결과 없음.
