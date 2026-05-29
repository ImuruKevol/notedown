# Electron 드래그 영역 및 노트 삭제 액션 추가

## Original Request

현재 앱을 이동하는 것이 불가능하고 이동할 수 있는 영역이 없다. 문서별로 삭제할 수 있는 기능이 없으며, 사이드바에서 `로컬 저장`이라고 표시하는 카드 영역은 삭제해야 한다.

## Summary

- Electron 창 이동을 위해 전역 스타일에 `app-region`/`-webkit-app-region` 기반의 `app-drag`, `app-no-drag` 클래스를 추가했다.
- 노트 화면 헤더, 사이드바 헤더, 설정 화면 헤더, 모바일 상단바를 드래그 가능 영역으로 지정했다.
- 버튼, 링크, 입력창, Monaco editor는 no-drag 영역으로 지정해 클릭/편집 동작과 창 이동이 충돌하지 않도록 했다.
- 사이드바 노트 목록을 버튼 중첩 없이 행 구조로 바꾸고, 각 노트마다 삭제 버튼을 추가했다.
- 삭제 시 localStorage의 노트 목록과 active note id를 갱신하고, 선택 중인 노트를 삭제하면 다음 노트로 자동 전환하도록 했다.
- 마지막 노트를 삭제했을 때 본문에 삭제된 노트가 남지 않도록 노트 화면에 빈 노트 fallback을 추가했다.
- 사이드바 하단의 `로컬 저장` 카드 영역을 제거했다.

## Changed Files

- Modified: `src/angular/styles/styles.scss`
- Modified: `src/app/layout.sidebar/view.pug`
- Modified: `src/app/component.nav.sidebar/view.pug`
- Modified: `src/app/component.nav.sidebar/view.ts`
- Modified: `src/app/page.notes/view.pug`
- Modified: `src/app/page.notes/view.ts`
- Modified: `src/app/page.settings/view.pug`
- Modified: `devlog.md`
- Added: `devlog/2026-05-27/005-electron-drag-note-delete.md`

## Verification

- `wiz_project_build(clean=false)` succeeded.
- `node --check electron/main.cjs` succeeded.
- `node --check electron/preload.cjs` succeeded.
- `npm run electron`으로 새 번들을 실행해 사이드바의 `로컬 저장` 카드가 제거되고, 각 노트 행에 `Delete note` 버튼이 렌더링되는 것을 확인했다.
- `bundle/www/styles.css`에 `app-region: drag` 및 `-webkit-app-region: drag`가 반영된 것을 확인했다.
