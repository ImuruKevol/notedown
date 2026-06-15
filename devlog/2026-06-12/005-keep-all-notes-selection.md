# 모든 노트 선택 상태 유지 보정

## 원 요청

> 이제는 왜 모든 노트 폴더가 선택이 안되니?

## 변경 파일

- `src/app/component.nav.sidebar/view.ts`
- `devlog.md`
- `devlog/2026-06-12/005-keep-all-notes-selection.md`

## 변경 내용

- `handleSelectNote()`가 노트 선택 이벤트를 받을 때 `activeFolder === 'all'`이면 노트의 실제 폴더로 `activeFolder`를 덮어쓰지 않도록 수정했다.
- 특정 폴더 선택 상태에서 외부 노트 선택이 들어오는 경우에는 기존처럼 선택 노트의 폴더로 이동하도록 유지했다.

## 확인 결과

- `wiz_project_build(projectName="main", clean=false)` 성공.
- 빌드 산출물 `project/main/build/dist/build/main.js`에 `activeFolder !== "all"` 조건이 반영된 것을 확인했다.
- 검증 쿠키(`season-wiz-project=main`, `season-wiz-devmode=true`)를 포함해 요청 링크 `http://172.16.0.143:3009`에 접속을 시도했지만, 현재 환경에서 서버 연결이 실패해 브라우저 시각 검증은 수행하지 못했다.
