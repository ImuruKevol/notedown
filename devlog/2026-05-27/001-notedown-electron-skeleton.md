# Notedown Electron 로컬 노트 앱 스켈레톤 구성

## Original Request

notion과 같은 마크다운 기반 노트 앱을 Electron으로 만들거야. 현재 환경은 mac studio이고, 서버 기반이 아니라 로컬 기반 노트 앱을 만들거야. 일단 필요 없는 샘플 코드들을 전부 지우고 스켈레톤 페이지들부터 구성해줘. 노트 화면, 설정 화면만 있으면 될 것 같아. 레이아웃은 노션을 그대로 따라하면 되고, 스타일&디자인은 노션 기반으로 하되 트렌디하고 모던한 느낌인데 심플한 느낌으로 구성해줘. 물론 로고도 새로 만들어서 적용해야해. 필요한 패키지가 있으면 설치하고.

## Summary

- 기존 인증/대시보드/멤버/게시글 샘플 페이지와 `portal/post` 샘플 패키지를 제거했다.
- `page.notes`와 `page.settings`를 추가하고 Notion형 사이드바 레이아웃으로 연결했다.
- Notedown 로고/아이콘 SVG를 새로 만들고 index 메타데이터, README, 언어 리소스를 정리했다.
- Electron 최소 실행 셸을 추가하고 `electron` devDependency를 설치했다.

## Changed Files

- Added: `electron/main.cjs`, `electron/preload.cjs`
- Added: `src/app/page.notes/app.json`, `src/app/page.notes/view.pug`, `src/app/page.notes/view.ts`
- Added: `src/app/page.settings/app.json`, `src/app/page.settings/view.pug`, `src/app/page.settings/view.ts`
- Added: `src/assets/brand/icon.svg`
- Modified: `README.md`, `package.json`
- Modified: `src/angular/app/app-routing.module.ts`, `src/angular/index.pug`, `src/angular/styles/styles.scss`
- Modified: `src/app/layout.sidebar/view.pug`, `src/app/layout.sidebar/view.ts`
- Modified: `src/app/component.nav.sidebar/view.pug`, `src/app/component.nav.sidebar/view.ts`
- Modified: `src/assets/brand/logo-black.svg`, `src/assets/brand/logo-white.svg`, `src/assets/lang/ko.json`, `src/assets/lang/en.json`
- Modified: `src/model/struct.py`
- Modified: `devlog.md`
- Added: `devlog/2026-05-27/001-notedown-electron-skeleton.md`
- Removed: `src/app/page.access/`, `src/app/page.dashboard/`, `src/app/page.members/`, `src/app/page.mypage/`, `src/app/page.posts/`, `src/app/page.posts.item/`
- Removed: `src/portal/post/`, `src/controller/user.py`, `src/controller/admin.py`, `src/model/db/user.py`, `src/model/struct/user.py`, `src/assets/bg-blue.jpg`

## Verification

- `wiz_project_build(clean=false)` succeeded.
- `node --check electron/main.cjs` succeeded.
- `node --check electron/preload.cjs` succeeded.
- `npx electron --version` returned `v42.3.0`.
