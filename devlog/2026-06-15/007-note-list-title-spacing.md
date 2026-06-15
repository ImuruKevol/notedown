# 노트 목록 제목 헤더와 노트 행 수직 여백 보정

- **ID**: 007
- **날짜**: 2026-06-15
- **유형**: UI 개선

## 작업 요약

첨부 스크린샷 기준으로 노트 목록 상단의 `모든 노트` 제목 영역이 위로 붙고 아래쪽 여백이 크게 보이는 문제를 줄였다.
제목과 보조 행의 line-height/높이를 명시하고, 정렬/검색/새 노트 버튼을 한 단계 더 작게 조정했다.
개별 노트 이름 버튼도 line-height로 세로 위치를 맞추던 방식에서 flex 중앙 정렬로 바꿔 글자 시각 중심이 행 중앙에 오도록 보정했다.

## 원문 요청사항

```text
첨부된 스크린샷과 같이 노트 이름 부분이 여백이 이상하게 되어있어. 위쪽 여백이 거의 없고 아래쪽 여백이 과도하게 높아
```

## 변경 파일 목록

- `src/app/component.nav.sidebar/view.pug`
  - 노트 목록 헤더 제목에 `leading-5`, 보조 행에 `h-7`/`leading-7`을 적용했다.
  - 헤더 액션 버튼 크기를 `size-7`로 줄이고 드롭다운 위치를 `top-8`로 보정했다.
- `src/app/component.nav.sidebar/view.ts`
  - 노트 행 제목 버튼을 `flex items-center` 기반으로 바꿔 텍스트를 수직 중앙 정렬했다.
  - 정렬/검색 버튼 class의 기본 크기를 `size-7`로 맞췄다.
- `devlog.md`, `devlog/2026-06-15/007-note-list-title-spacing.md`
  - 작업 이력을 추가했다.

## 검증 결과

- `wiz_project_build(clean=false)` 성공.
- `node --check electron/main.cjs` 통과.
- `node --check electron/preload.cjs` 통과.
- `git diff --check` 통과.
- 빌드 산출물 `build/dist/build/main.js`, `bundle/www/main.js`에서 `leading-5`, `h-7`, `size-7`, `top-8` 변경이 반영된 것을 확인했다.
- `season-wiz-project=main; season-wiz-devmode=true` 쿠키를 포함해 제공 리뷰 URL `http://172.16.0.143:3009`에 요청했지만 현재 환경에서 연결되지 않아 실제 브라우저 렌더링 검증은 수행하지 못했다.

## 남은 리스크

- 리뷰 URL이 열리지 않아 첨부 스크린샷과 같은 Electron/macOS 창에서 시각적으로 재확인하지 못했다.
