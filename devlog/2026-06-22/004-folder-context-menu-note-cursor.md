# 폴더 컨텍스트 메뉴와 새 노트 커서 위치 개선

- **ID**: 004
- **날짜**: 2026-06-22
- **유형**: 기능 추가

## 작업 요약
폴더 우클릭 컨텍스트 메뉴를 추가하고 기존 폴더 이름 수정 액션을 메뉴로 이동했습니다. 컨텍스트 메뉴에서 폴더 삭제와 Electron ZIP 내보내기를 지원하도록 했고, 새 노트 생성 후 커서가 첫 줄 끝으로 가도록 에디터 포커스 흐름을 조정했습니다.

## 원문 요청사항
```text
폴더 목록 패널
- +를 누르니까 폴더는 생기는데 생성된 폴더가 이름 수정모드로 바뀌질 않아.
- 폴더에 우클릭 시 컨텍스트 메뉴가 보이게 하고, 편집 아이콘 버튼을 거기로 옮겨줘. 그리고 해당 폴더 삭제도 가능하도록 해줘. 당연하지만 확인 모달은 있어야 해.
- 폴더 컨텍스트 메뉴에 해당 폴더를 통채로 내보내기(zip) 기능을 추가해줘.

노트 목록 패널 & 에디터
- +를 눌러서 새 노트가 생기고 나면 입력 포커스가 맨 첫줄의 맨 앞으로 가있는데, 맨 첫줄의 맨 뒤로 입력 포커스가 가도록 해줘.
- 왼쪽 하단의 폴더 목록 패널 접기 버튼이 동작하지 않아.
```

## 변경 파일 목록
- `src/app/component.nav.sidebar/view.ts`: 새 폴더 생성 후 rename focus 보정, 폴더 컨텍스트 메뉴 상태/액션, 폴더 삭제 확인 및 ZIP 내보내기 호출, 폴더 패널 수동 접기 복구.
- `src/app/component.nav.sidebar/view.pug`: 폴더 우클릭 메뉴 UI 추가, 기존 hover 편집 버튼 제거, rename input 타깃을 폴더 ID로 변경.
- `src/app/layout.sidebar/view.ts`: workspace panel 이벤트의 열림/닫힘 값을 다시 반영하도록 수정.
- `src/app/page.notes/view.ts`: 새 노트 생성/선택 시 첫 줄 끝으로 커서를 이동하는 포커스 옵션 추가.
- `electron/main.cjs`: 폴더 ZIP 내보내기 IPC 및 ZIP entry 생성 로직 추가.
- `electron/preload.cjs`: `notedown.storage.exportFolderZip` 브리지 추가.
- `src/angular/app/notedown-android-bridge.ts`: Android 환경의 ZIP 내보내기 미지원 응답 추가.

## 검증 결과
- `wiz_project_build(clean=false, projectName="main")` 성공.
- `node -c electron/main.cjs` 및 `node -c electron/preload.cjs` 성공.
- 변경 파일 대상 `git diff --check` 통과.
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 붙여 요청 링크 서버 응답 및 `/login` 리다이렉트 확인.
