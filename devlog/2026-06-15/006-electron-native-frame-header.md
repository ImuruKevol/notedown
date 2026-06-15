# Electron 기본 창 프레임 복구 및 좌상단 헤더 여백 정리

- **ID**: 006
- **날짜**: 2026-06-15
- **유형**: UI 개선

## 작업 요약

Electron 창을 `hiddenInset` 기반 프레임리스 스타일에서 기본 OS 프레임으로 되돌렸다.
macOS 좌상단 창 버튼을 피하려고 추가했던 설정 화면 안전 여백과 노트 목록 헤더의 큰 상단 보정/우측 정렬을 제거해, 기본 프레임 아래에서 자연스럽게 시작하도록 정리했다.

## 원문 요청사항

```text
작업 시작

리뷰 ID: fjhgursreksrgruiaiqdcfhskgdxbotz
제목: Electron app UI 수정?

electron 앱을 frameless로 하니까 맥에서 어떻게 해도 왼쪽 상단의 버튼 3개 때문에 레이아웃과 디자인이 꼬이고 있어. 헤더 프레임을 되살려줘. 그리고 그에 따라 각 화면들의 왼쪽 상단 부분 디자인을 수정해줘.
```

## 변경 파일 목록

- `electron/main.cjs`
  - `BrowserWindow` 옵션에서 `titleBarStyle: 'hiddenInset'`을 제거하고 `frame: true`를 명시했다.
- `src/app/component.nav.sidebar/view.pug`
  - 노트 목록 헤더의 macOS 버튼 회피용 큰 높이/하단 정렬을 제거하고, 폴더명을 다시 좌측 정렬했다.
- `src/app/page.settings/view.pug`
  - 설정 헤더의 macOS 버튼 회피용 `pl-[88px]` 여백을 제거하고 균일한 좌우 여백으로 변경했다.
- `devlog.md`, `devlog/2026-06-15/006-electron-native-frame-header.md`
  - 작업 이력을 추가했다.

## 검증 결과

- `wiz_project_build(clean=false)` 성공.
- `node --check electron/main.cjs` 통과.
- `node --check electron/preload.cjs` 통과.
- `git diff --check` 통과.
- 빌드 산출물 `build/dist/build/main.js`, `bundle/www/main.js`에서 노트 목록 헤더의 `h-16`/`text-left` 변경과 설정 헤더의 `px-5` 변경이 반영된 것을 확인했다.
- `season-wiz-project=main; season-wiz-devmode=true` 쿠키를 포함해 요청한 제공 리뷰 URL `http://172.16.0.143:3009`와 `http://localhost:3009`는 현재 환경에서 연결되지 않아 실제 브라우저 렌더링 검증은 수행하지 못했다.

## 남은 리스크

- 현재 환경에서 리뷰 URL이 열리지 않아 macOS 실제 Electron 창의 네이티브 프레임 표시와 좌상단 배치만 직접 육안 확인하지 못했다.
