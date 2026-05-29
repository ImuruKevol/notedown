# 설정 타이틀바 안전 여백 및 노트 목록 압축 레이아웃 적용

## Original Request

설정 화면에서는 상단 헤더 부분이 왼쪽 상단의 닫기/최소화/fullscreen 버튼 3개에 겹치고 있으므로 수정해야 한다. 노트 목록의 width가 너무 과도하게 넓어서 지금의 2/3 정도로 줄이고, 각 문서별 카드가 차지하는 height가 너무 길어서 Notion처럼 문서 제목만 보여주고 한 줄씩만 차지하도록 바꿔야 한다.

## Summary

- 노트 화면의 데스크톱 고정 사이드바 폭을 `376px`에서 `256px`로 줄이고 본문 좌측 패딩도 동일하게 조정했다.
- 모바일 사이드바 폭 상한도 `320px`로 줄여 과도하게 넓어지지 않도록 했다.
- 노트 목록 아이템에서 요약, 업데이트 시간, 우측 아이콘을 제거하고 문서 제목만 보이는 1줄 리스트 행으로 변경했다.
- 노트 목록 아이템 스타일을 `h-8` 기반의 Notion형 compact row로 바꿨다.
- 설정 화면 상단 헤더에 macOS Electron `hiddenInset` 타이틀바 버튼 영역을 피하는 좌측 안전 여백과 높이/하단 정렬을 적용했다.

## Changed Files

- Modified: `src/app/layout.sidebar/view.pug`
- Modified: `src/app/layout.sidebar/view.ts`
- Modified: `src/app/component.nav.sidebar/view.pug`
- Modified: `src/app/component.nav.sidebar/view.ts`
- Modified: `src/app/page.settings/view.pug`
- Modified: `devlog.md`
- Added: `devlog/2026-05-27/004-settings-titlebar-compact-note-list.md`

## Verification

- `wiz_project_build(clean=false)` succeeded.
- `node --check electron/main.cjs` succeeded.
- `node --check electron/preload.cjs` succeeded.
- `npm run electron`으로 앱을 실행해 노트 목록 폭 축소, 1줄 문서 리스트, 설정 화면 헤더의 macOS 버튼 영역 회피를 확인했다.
