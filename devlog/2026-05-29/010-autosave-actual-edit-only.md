# 실제 본문 편집 시에만 자동 저장되도록 노트 저장 이벤트 개선

## 요청

ReviewOps `qnnlfkkeiaipqaupqtbvqcwuzgfadzdv` - 자동 저장 로직 때문에 문서를 새로 만들거나 순서대로 열 때 열자마자 저장되어, 수정일 최신순 정렬에서 왼쪽 노트 목록 순서가 계속 꼬이므로 실제 편집이 있을 때만 자동 저장이 동작하도록 개선해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.pug`
- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-05-29/010-autosave-actual-edit-only.md`

## 변경 내용

- Monaco editor 본문 바인딩을 양방향 `[(ngModel)]` + 즉시 `touchNote()` 호출에서, 단방향 `[ngModel]` + `handleBodyChange($event)` 호출로 변경했다.
- `handleBodyChange`에서 새 본문 값과 현재 `activeNote.body`가 같으면 저장하지 않도록 가드했다.
- 실제 본문 값이 달라진 경우에만 `activeNote.body`를 갱신하고 `touchNote()`를 호출해 수정일 갱신, localStorage/file persistence, 미리보기 갱신이 실행되도록 했다.
- 제목 편집, 체크리스트 토글, 새 노트 생성처럼 실제 사용자 변경에 해당하는 기존 저장 흐름은 유지했다.

## 검증

- `wiz_project_build(clean=false)` 성공.
- `http://172.16.0.143:3009`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 HTTP 200 응답과 빌드 시각 반영을 확인했다.
- `src/app/page.notes/view.ts`와 `src/app/page.notes/view.pug`에서 editor change가 `handleBodyChange`로 연결되고 동일 본문 값은 저장을 건너뛰는 것을 확인했다.
- 인앱 브라우저 세션이 현재 노출되지 않아 실제 클릭 기반 브라우저 검증은 수행하지 못했다.
