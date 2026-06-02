# 충돌 diff editor 로드 전 textarea fallback 제거

## 요청

ReviewOps `xbyheezgknlyegsiclrqtcoobtbagpte` - 충돌 뷰어가 처음 로드될 때 일반 textarea로 보이다가 한참 후에 Monaco diff editor가 로드된다. Monaco diff editor가 로드되기 전에는 로딩 중이라는 표시만 뜨도록 해야 한다.

## 변경 파일

- `src/app/page.notes/view.pug`
- `devlog.md`
- `devlog/2026-06-01/006-sync-conflict-diff-loading-state.md`

## 변경 내용

- 충돌 뷰어의 `!syncConflictDiffReady` fallback에서 서버/로컬 readonly textarea를 제거했다.
- diff editor가 준비되기 전에는 중앙 정렬된 spinner와 로딩 문구만 표시하도록 변경했다.
- 충돌 파일 내용을 읽는 중일 때와 Monaco diff editor를 불러오는 중일 때 문구를 분리했다.

## 검증

- `wiz_project_build(clean=false)` 성공.
- `git diff --check` 성공.
- `rg`로 충돌 뷰어 fallback textarea가 제거되고 로딩 문구가 연결된 것을 확인했다.
- `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009` 요청 시 200 OK 및 최신 `Last-Modified: Mon, 01 Jun 2026 07:10:41 GMT` 응답을 확인했다.
