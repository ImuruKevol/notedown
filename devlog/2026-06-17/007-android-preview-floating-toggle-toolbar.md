# Android preview 기본 모드 및 플로팅 토글/툴바 첨부 보강

## 요청

- 리뷰 ID: `xxvinnsvhifwqghifludssinzxljtknm`
- 원문 요청: "- 툴바에 코드 아이콘을 누르면 ``` 에 해당하는 코드블럭이 삽입이 되어야 해.
- 툴바에 H1 아이콘을 눌러도 H1~H3 선택 메뉴가 나오지 않고 있어.
- 파일 및 이미지를 첨부한 후 에디터에서 바로 추가할 수 있도록 툴바에 추가해줘.
- 그냥 다단 모드는 가로가 충분한 너비가 있어도 못보도록 제거해줘. 그리고 에디터, preview 토글 메뉴는 화면 우측 하단에 플로팅 버튼 형태로 수정해줘. 버튼은 두개로 하지 말고 하나로만 해서 누르면 active, 다시 누르면 inactive로 해서.
- 헤더에 라인 넘버 표시 기능이 동작하지 않아.
- 헤더에 pdf로 export하는 기능이 동작하지 않아.
- 에디터 모드가 활성화가 되면 에디터에 포커싱이 자동으로 잡히면서 키보드가 올라오는데, 굳이 키보드가 올라올 필요 없어.
- 노트를 열면 기본적으로 preview 모드로 열리게 해줘."

## 변경 파일

- `src/app/page.notes/view.ts`: Android split 완전 비활성화, 기본 preview 모드 적용, editor/preview 단일 플로팅 토글 추가, Android 자동 포커스 억제, 코드 툴바를 fenced code block 삽입으로 변경, 툴바 파일/이미지 첨부 후 즉시 Markdown 삽입 처리, 라인번호 토글 렌더 갱신 추가
- `src/app/page.notes/view.pug`: Android 헤더 모드 버튼 숨김, H1~H3 메뉴를 toolbar 아래 행으로 표시, 파일/이미지 툴바 아이콘 추가, 우측 하단 플로팅 preview 토글 버튼 추가
- `src/app/page.settings/view.ts`: Android split 설정 옵션이 넓은 화면에서도 노출되지 않도록 유지
- `devlog.md`, `devlog/2026-06-17/007-android-preview-floating-toggle-toolbar.md`: 작업 로그 추가

## 확인

- `wiz_project_build`: 성공
- `npm run android:build:debug`: 성공
- 무선 ADB 설치 재시도 시점에는 `SM_F966N` 연결이 끊겨 `adb devices -l` 결과가 비어 있었음
- `adb mdns services`에서도 무선 디버깅 서비스가 발견되지 않았음

## 참고

- PDF export는 헤더의 Android 가용 공간 문제를 줄이기 위해 모드 버튼을 제거해 접근성을 개선했다. 실제 Android 저장 picker까지의 동작은 기기 재연결 후 확인이 필요하다.
- 파일/이미지 picker에서 실제 파일을 고르는 흐름은 무선 디버깅 세션 종료로 이번 턴에서 실기기 검증하지 못했다.
