# 폴더 선택 시 폴더 패널 유지

## 원 요청

> 폴더를 선택하면 폴더 패널이 바로 닫히고 있는데, 바로 닫히게 하지 말아줘.

## 변경 파일

- `src/app/component.nav.sidebar/view.ts`
- `devlog.md`
- `devlog/2026-06-12/004-keep-folder-panel-open-on-select.md`

## 변경 내용

- `selectFolder()`에서 폴더 선택 직후 `closeWorkspace()`를 호출하던 동작을 제거했다.
- 폴더 선택 상태 저장, 워크스페이스 변경 이벤트 발행, 첫 노트 자동 선택 동작은 그대로 유지했다.

## 확인 결과

- `wiz_project_build(projectName="main", clean=false)` 성공.
- `selectFolder()` 내부에서 즉시 패널을 닫는 호출이 제거된 것을 소스에서 확인했다.
- 검증 쿠키(`season-wiz-project=main`, `season-wiz-devmode=true`)를 포함해 요청 링크 `http://172.16.0.143:3009`에 접속을 시도했지만, 현재 환경에서 서버 연결이 실패해 브라우저 시각 검증은 수행하지 못했다.
