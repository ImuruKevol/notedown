# 앱 시작 렌더링 지연을 줄이도록 시작 동기화 비동기화

## 요청

ReviewOps `zfxxldcdyylooleidmoqfsztxbbqnhzf` - 앱을 열 때 흰 화면이 오래 지속된 뒤 렌더링되는 현상이 충돌 뷰어와 동기화 로직 수정 이후 발생했으므로, 앱 시작 시 오래 기다리지 않도록 최적화해 달라는 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-06-02/004-startup-render-sync-deferral.md`

## 변경 내용

- 노트 화면 초기화에서 시작 동기화를 기다린 뒤 노트를 로드하던 순서를 바꿔, localStorage 캐시 또는 기본 노트를 먼저 즉시 렌더링하도록 했다.
- 파일 저장소 재로드와 서버 시작 동기화는 첫 렌더 이후 백그라운드 작업으로 지연했다.
- 시작 동기화가 이미 같은 세션에서 완료된 경우에만 기존 충돌 결과를 다시 적용하고, 새 시작 동기화가 실행되는 경우에는 최신 결과로 충돌 뷰어를 갱신하도록 했다.
- 백그라운드 동기화/충돌 상세 로딩이 완료된 뒤 noop zone 환경에서도 화면이 갱신되도록 `ChangeDetectorRef` 기반 deferred view update를 추가했다.
- 시작 동기화 성공 또는 충돌 결과가 돌아오면 파일 저장소 노트를 다시 읽어 다운로드/충돌 처리 후 목록과 에디터 상태가 최신화되도록 했다.
- 노트 화면이 직접 보낸 시작 동기화 이벤트는 다시 처리하지 않도록 표시해 충돌 상세 로딩이 중복 실행되지 않게 했다.

## 검증

- `wiz_project_build(clean=false)` 성공.
- `node --check project/main/electron/main.cjs && node --check project/main/electron/preload.cjs` 성공.
- `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009` 요청 시 200 OK 및 최신 `Last-Modified: Tue, 02 Jun 2026 02:24:30 GMT` 응답을 확인했다.
- `src/app/page.notes/view.ts`와 `devlog.md`에서 conflict marker 검색 결과 없음.
- `src/app/page.notes/view.ts` trailing whitespace 검색 결과 없음.
- Browser 플러그인 검증은 `iab` 브라우저가 제공되지 않아 실행하지 못했다.
