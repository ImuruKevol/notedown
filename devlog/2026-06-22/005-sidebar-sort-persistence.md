# 노트 목록 정렬 기준 보존

- **ID**: 005
- **날짜**: 2026-06-22
- **유형**: 버그 수정

## 작업 요약
노트 목록 패널의 정렬 기준을 localStorage에 저장하고 앱 시작 시 복원하도록 수정했습니다. 다른 창이나 저장소 이벤트로 정렬 값이 바뀌는 경우에도 같은 key를 다시 읽도록 보강했습니다.

## 원문 요청사항
```text
노트 목록 패널에서 정렬 기준이 앱을 끄면 보존이 되지 않던데 보존이 되도록 해줘.
```

## 변경 파일 목록
- `src/app/component.nav.sidebar/view.ts`: `notedown.sidebar.sort.v1` 저장 key 추가, `ngOnInit` 복원, 정렬 선택 시 저장, storage 이벤트 복원 처리 추가.

## 검증 결과
- `wiz_project_build(clean=false, projectName="main")` 성공.
- 변경 파일 대상 `git diff --check` 통과.
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 붙여 요청 링크 서버 응답 및 `/login` 리다이렉트 확인.
