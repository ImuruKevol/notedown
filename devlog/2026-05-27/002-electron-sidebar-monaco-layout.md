# Electron 로고 에셋 복구 및 macOS 메모형 2단 노트 레이아웃 개선

## Original Request

일단 electron으로 띄웠을 때 로고 이미지가 불러와지지 않고 있어. 왼쪽 사이드바의 로고 아래 검색 input은 제일 하단의 노트 목록 부분으로 이동하고, 노트 목록이 없다면 표시하지 말 것. 노트, 설정 메뉴 목록은 삭제하되 설정 화면은 사이드바 제일 하단으로 이동할 것. 사이드바는 첨부한 macOS 메모 앱처럼 2단으로 나누어 구성할 것. 노트 화면 컨텐츠 영역은 맨 위 헤더와 에디터만 남기고, 추후 공유 버튼이 들어갈 버튼 영역을 잡아둘 것. 에디터는 Monaco 수준의 편의성, 탭 동작, 줄 수 표시 토글, 마크다운 자동완성, Notion의 `/` 기능을 제공할 것. 작성/분할/미리보기는 텍스트 없이 작은 아이콘 토글 버튼으로 에디터 오른쪽 상단에 배치할 것.

## Summary

- Electron 번들에서 로고가 누락되지 않도록 `src/assets`를 Angular 빌드 에셋에 포함하고 index 아이콘 경로를 상대 경로로 정리했다.
- 사이드바를 macOS 메모 앱 방식의 폴더 컬럼과 노트 목록 컬럼 2단 구조로 재구성했다.
- 검색 input을 노트 목록 컬럼으로 이동하고, 노트 데이터가 없으면 표시하지 않도록 조정했다.
- 기존 노트/설정 메뉴 목록을 제거하고 설정 링크를 사이드바 하단으로 옮겼다.
- 노트 화면은 헤더와 에디터만 남기고, 헤더에는 향후 공유 버튼이 들어갈 영역을 예약했다.
- Monaco 기반 마크다운 편집기에 탭/줄 번호 토글/자동완성/슬래시 명령과 작성·분할·미리보기 아이콘 토글을 추가했다.

## Changed Files

- Modified: `src/angular/angular.build.options.json`
- Modified: `src/angular/angular.json`
- Modified: `src/angular/index.pug`
- Modified: `src/app/layout.sidebar/view.pug`
- Modified: `src/app/component.nav.sidebar/view.pug`
- Modified: `src/app/component.nav.sidebar/view.ts`
- Modified: `src/app/page.notes/view.pug`
- Modified: `src/app/page.notes/view.ts`
- Modified: `devlog.md`
- Added: `devlog/2026-05-27/002-electron-sidebar-monaco-layout.md`

## Verification

- `wiz_project_build(clean=false)` succeeded.
- `bundle/www/assets/brand`에 `icon.ico`, `icon.svg`, `logo-black.svg`, `logo-white.svg`가 생성되는 것을 확인했다.
- `node --check electron/main.cjs` succeeded.
- `node --check electron/preload.cjs` succeeded.
- `npm run electron`으로 Electron 앱 실행을 확인했으며, UI 직접 검증은 macOS Computer Use 권한 미부여로 진행하지 못했다.
