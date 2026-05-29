# 설정 화면 사이드바 카드 제거 및 메뉴 통합

## 요청

리뷰 ID `oywmjfzkcdypkjpyjvlguavbzkhmvxdf`의 요청. 원문 요청은 `작업 시작`이며, 리뷰어 요청 내용은 설정 화면 왼쪽 사이드바의 `Workspace Notedown` 카드 삭제와 `작업공간`, `편집기`, `화면` 메뉴의 단일 메뉴 통합.

## 변경 파일

- `src/app/page.settings/view.pug`
- `src/app/page.settings/view.ts`
- `devlog.md`
- `devlog/2026-05-29/003-settings-sidebar-cleanup.md`

## 변경 내용

- 설정 화면 왼쪽 사이드바에서 Workspace 이름 카드 영역을 제거했다.
- 설정 메뉴를 `일반`, `저장소` 두 항목으로 줄였다.
- 기존 `작업공간`, `편집기`, `화면` 설정 내용을 `일반` 섹션 안의 하위 영역으로 통합했다.
- 기본 활성 섹션을 `workspace`에서 `general`로 변경했다.

## 검증

- `wiz_project_build(clean=false)` 성공
- `curl -I`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함해 `http://172.16.0.143:3009/settings`가 `200 OK`로 응답하는 것을 확인했다.
- 빌드 산출물 `main.js`에 설정 화면 템플릿이 `일반`/`저장소` 메뉴와 통합된 `일반` 섹션으로 반영된 것을 확인했다.

## 남은 리스크

- 인앱 Browser `iab`가 현재 사용 가능한 브라우저를 노출하지 않아 실제 화면 조작 검증은 수행하지 못했다.
