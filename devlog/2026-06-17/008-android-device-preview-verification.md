# Android 실기기 검증 및 preview 초기 진입 보정

## 원 요청

무선 디버깅 연결을 다시 해두었으니 수정한 Android 앱 동작을 확인.

## 변경 파일

- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-06-17/008-android-device-preview-verification.md`

## 작업 내용

- Android 판별 로직이 `window.notedown.platform`에만 의존하지 않도록 Capacitor platform과 userAgent fallback을 추가.
- 브리지 초기화 순서와 무관하게 Android 앱 새 실행 시 노트 화면이 preview 모드로 시작되도록 보정.

## 확인 결과

- `wiz_project_build` 성공.
- `npm run android:build:debug` 성공.
- 무선 ADB 장치 `SM_F966N`에 `app-debug.apk` 재설치 성공.
- 새 실행 후 `https://localhost/notes` WebView에서 기본 preview 모드, header mode button 제거, split button 제거, 우하단 단일 floating toggle 동작 확인.
- floating toggle로 editor 전환 시 textarea 자동 포커스가 잡히지 않는 것 확인.
- Android toolbar의 H1 메뉴가 H1/H2/H3 목록을 표시하는 것 확인.
- 코드 버튼이 fenced code block을 삽입하는 것 확인 후 본문 원복.
- 파일/이미지 첨부 버튼과 Android attachment bridge API 노출 확인.
- preview 라인 넘버 토글 동작 및 PDF 저장 버튼/bridge API 노출 확인.
- 최근 logcat에서 앱 crash/fatal 로그 없음.
