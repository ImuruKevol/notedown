# 숨김 워크스페이스 패널 및 설정 전체폭 레이아웃 개선

## Original Request

사이드바 중에 첫 번째(워크스페이스 선택, 새 폴더, 설정)는 기본적으로 숨김 상태여야 한다. 사이드바 아랫부분이 통째로 비어 보여 이질감이 있으니 자연스럽고 모던하게 수정해야 한다. 설정 버튼을 누르면 현재는 컨텐츠 영역에만 뜨는데, 전체 레이아웃을 수정해서 설정 부분이 중간 영역(노트 목록)과 컨텐츠 영역을 모두 차지해서 보여주도록 해야 한다.

## Summary

- 데스크톱 노트 화면의 고정 사이드바 폭을 노트 목록 컬럼 기준으로 줄이고, 워크스페이스/폴더/설정 컬럼은 기본적으로 렌더링되지 않는 숨김 패널로 변경했다.
- 노트 목록 상단에 워크스페이스 패널 토글 버튼을 두고, 하단에는 설정 진입 아이콘을 유지했다.
- 사이드바 컴포넌트가 부모 높이를 채우도록 `wiz-component-nav-sidebar`에 `block h-full min-h-0` 클래스를 적용해 하단 풋터가 중간에 떠 보이는 문제를 수정했다.
- 노트 목록 컬럼의 배경, 최근 섹션, 로컬 저장 상태, 하단 풋터 스타일을 정리해 빈 영역이 덜 이질적으로 보이도록 개선했다.
- `/settings` 라우트에서는 고정 노트 목록 사이드바를 제거하고 설정 페이지가 노트 목록 영역과 컨텐츠 영역 전체를 차지하도록 `layout.sidebar`를 라우트 인식형으로 변경했다.
- 설정 화면은 자체 좌측 설정 내비게이션과 본문 영역을 갖는 전체 높이 레이아웃으로 재구성했다.

## Changed Files

- Modified: `src/app/layout.sidebar/view.pug`
- Modified: `src/app/layout.sidebar/view.ts`
- Modified: `src/app/component.nav.sidebar/view.pug`
- Modified: `src/app/component.nav.sidebar/view.ts`
- Modified: `src/app/page.settings/view.pug`
- Modified: `devlog.md`
- Added: `devlog/2026-05-27/003-hidden-workspace-settings-layout.md`

## Verification

- `wiz_project_build(clean=false)` succeeded.
- `node --check electron/main.cjs` succeeded.
- `node --check electron/preload.cjs` succeeded.
- `npm run electron`으로 앱을 실행하고 노트 화면에서 첫 번째 워크스페이스 컬럼이 기본 숨김 상태인 것을 확인했다.
- Electron 화면에서 사이드바 하단 풋터가 창 하단에 고정되고, 설정 링크 클릭 시 URL이 `notedown://app/settings`로 전환되며 설정 화면이 노트 목록 영역과 컨텐츠 영역 전체를 차지하는 것을 확인했다.
