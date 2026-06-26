# Android 폰 편집 UX 및 metadata 동기화 충돌 필터 보강

## 요청

- 리뷰 ID: `xxvinnsvhifwqghifludssinzxljtknm`
- 원문 요청: "안드로이드에서는 임의의 폴더를 저장소로 쓰는건 불가능한거 알아. 그러니까 이 부분은 안드로이드의 제약사항으로 놔두는게 맞아.

---

- android에서는 editor/다단/preview 3개 모드 말고 그냥 무조건 editor와 preview를 토글해서만 볼 수 있도록 해줘. 폰에서 다단으로 왼쪽에는 editor, 오른쪽에 preview를 두는건 힘들 것 같아.
  - 단, 갤럭시 폴드와 같은 경우를 위해서 가로 화면 길이가 일정 너비 이상일 경우엔 다단 모드를 보이게 해줘.
- 핸드폰에서 마크다운 문법을 치는건 굉장히 불편하므로, 에디터에는 위에 툴바를 추가해서 수동으로 쓰지 않더라도 바로 터치만으로 추가할 수 있도록 해줘.
- 설정 화면에 저장소 탭은 제거해줘. 어차피 안드로이드에서는 의미 없어.
- 서버 정보를 등록한 후 로그인하고 동기화를 하려고 하니까 metadata.json이 충돌되었다고 뜨는 버그가 있어. 이게 서버쪽 문제인지 안드로이드의 문제인지 확인해줘."

## 변경 파일

- `src/app/page.notes/view.ts`: Android 폰 폭에서 분할 모드 비활성화, 넓은 Android 화면 분할 허용, 터치용 Markdown 툴바 동작 추가, 시스템 파일 충돌 표시 필터 추가
- `src/app/page.notes/view.pug`: Android용 작성/미리보기 모드 버튼 렌더링, Markdown 툴바, 반응형 preview pane 클래스 연결
- `src/app/page.settings/view.ts`: Android에서 저장소 탭 숨김, 폰 폭에서 분할 기본 보기 선택 방지, 시스템 파일 충돌 카운트 보정
- `src/app/page.settings/view.pug`: Android 설정 탭/분할 옵션 조건부 렌더링
- `src/angular/app/notedown-android-bridge.ts`: 서버 manifest/plan의 `metadata.json`, `.notedown-sync.json` 파일 항목 제외 및 충돌 파일 읽기 가드 추가
- `electron/main.cjs`: 동일한 서버 manifest/plan 시스템 파일 제외 방어 추가
- `devlog.md`, `devlog/2026-06-17/005-android-phone-editor-sync-polish.md`: 작업 로그 추가

## 확인

- `wiz_project_build`: 성공
- `npm run android:build:debug`: 성공
- ADB 확인: `/opt/homebrew/bin/adb`, Android Debug Bridge 35.0.2
- AVD 확인: `Pixel_3a_API_34_extension_level_7_arm64-v8a`
- 에뮬레이터 부팅, `app-debug.apk` 설치, `com.notedown.app` 실행 성공
- Android WebView DOM 확인: CSS 폭 393px에서 모드 버튼은 `write`, `preview`만 표시되고 Markdown 툴바 표시
- Android WebView DOM 확인: CSS 폭 900px emulation에서 `write`, `split`, `preview` 표시
- 설정 화면 DOM 확인: Android 폰 폭에서 `저장소` 탭/섹션과 `분할` 기본 보기 옵션 미표시
- synthetic `metadata.json` 충돌 이벤트 확인: 충돌 화면과 `metadata.json` 경로가 표시되지 않음

## 판단

- 첨부 스크린샷의 `metadata.json` 충돌은 Android 저장소 제약 자체가 아니라, 서버 manifest/plan에 시스템 메타데이터 파일이 파일 동기화 항목처럼 포함될 때 클라이언트가 이를 충돌 대상으로 표시하던 필터 누락으로 판단했다.
- `metadata.json`은 서버 메타데이터 본문으로 비교하고, 파일 단위 동기화/충돌 UI에서는 제외하도록 Android와 Electron 양쪽에 방어를 추가했다.
