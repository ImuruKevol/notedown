# 에디터 복귀 시 커서 위치 복원

- **ID**: 003
- **날짜**: 2026-07-01
- **유형**: 버그 수정

## 작업 요약
앱을 벗어났다가 다시 돌아오거나 동기화 후 노트가 재로드될 때 에디터 커서와 스크롤 위치를 저장 후 복원하도록 수정했다.
Electron Monaco 에디터 경로와 Android textarea 경로 모두 같은 노트 재로드 시 작성 상태를 유지하도록 처리했다.

## 원문 요청사항
```text
electron app 뿐만 아니라 android에서도 확인하여 작업할 것.

앱을 연 상태로 작성을 하다가 다른 프로그램을 사용하다가 다시 앱으로 돌아오면 에디터의 커서가 맨 앞으로 이동하는 버그가 있음.
```

## 변경 파일 목록
- `src/app/page.notes/view.ts`
  - window blur/focus 및 visibility 변경 시 현재 에디터 selection/scroll 상태를 캡처하고 렌더 후 복원하도록 추가.
  - `notedown:notes-changed`, 시작 동기화/충돌 해결 후 노트 재로드 시 같은 노트의 커서 위치를 유지하도록 연결.
  - Android에서 같은 노트를 재선택하는 재로드 경로는 기존 작성/미리보기 모드를 유지하도록 수정.

## 검증 결과
- WIZ normal build 성공: `wiz_project_build(clean=false)`.
- Electron 앱 실행 후 Monaco 에디터에서 커서를 3행 6열로 이동하고 blur/focus 및 `notedown:notes-changed` 재로드를 시뮬레이션해 3행 6열과 scrollTop 24 유지 확인.
- Android 빌드 성공: `npm run android:build:debug`.
- `adb devices` 확인 결과 연결된 Android 실기기/에뮬레이터가 없어 실제 기기 런타임 확인은 수행하지 못함.
- 인앱 브라우저는 현재 세션에 사용 가능한 대상이 없어 직접 연결하지 못했다.
