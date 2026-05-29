# 설정 항목 정리 및 탭 크기 적용 연결

## 요청

리뷰 ID `oywmjfzkcdypkjpyjvlguavbzkhmvxdf`의 후속 요청. `압축 사이드바`, `글자 크기`, `맞춤법 검사` 설정 항목은 동작하지 않으니 제거하고, `탭 크기`는 실제 에디터에 적용되도록 수정하며, 저장소 디렉토리는 직접 입력이 아니라 Finder 같은 디렉토리 선택 방식으로 바꿔달라는 요청.

## 변경 파일

- `src/app/page.settings/view.pug`
- `src/app/page.settings/view.ts`
- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-05-29/004-settings-tab-size-storage-picker.md`

## 변경 내용

- 설정 화면에서 `압축 사이드바`, `글자 크기`, `맞춤법 검사` 항목과 관련 설정 필드를 제거했다.
- 기존 localStorage 설정을 읽을 때 현재 사용하는 설정 키만 정규화해 저장하도록 정리했다.
- `탭 크기` 값을 2~8 범위의 정수로 정규화하고 저장 이벤트를 발행하도록 했다.
- 노트 에디터의 Monaco 옵션이 저장된 `tabSize`를 읽어 편집기와 코드 프리뷰에 적용하도록 연결했다.
- 저장소 디렉토리 입력 필드를 제거하고 읽기 전용 경로 표시와 `디렉토리 선택` 버튼으로 바꿨다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `git diff --check -- src/app/page.settings/view.pug src/app/page.settings/view.ts src/app/page.notes/view.ts` 성공
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009/settings`와 `/notes`가 `200 OK`로 응답하는 것을 확인했다.
- 소스에서 제거 요청 항목(`압축 사이드바`, `글자 크기`, `맞춤법 검사`, `compactSidebar`, `spellcheck`)이 설정 화면에 남아 있지 않은 것을 확인했다.
- 빌드 산출물에 `setTabSize`, `editorTabSize`, `디렉토리 선택`, `notedown:settings-changed` 반영을 확인했다.

## 남은 리스크

- 인앱 Browser `iab`가 현재 사용 가능한 브라우저를 노출하지 않아 실제 화면 조작 검증은 수행하지 못했다.
