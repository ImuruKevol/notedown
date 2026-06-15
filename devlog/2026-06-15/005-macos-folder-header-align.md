# macOS 창 버튼과 겹치지 않도록 폴더 헤더 정렬 조정

- **ID**: 005
- **날짜**: 2026-06-15
- **유형**: UI 개선

## 작업 요약

macOS 창 컨트롤이 노트 목록 패널 상단의 선택 폴더명을 가리는 문제를 줄이기 위해 선택 폴더명 텍스트를 오른쪽 정렬로 변경했다.
이전 요청에서 의도했던 액션 버튼 축소가 실제 class 생성 메서드에도 반영되도록 정렬/검색 버튼 크기를 `size-8`로 조정했다.

## 원문 요청사항

```text
# ReviewOps Codex 작업 요청

아래 요청을 현재 프로젝트 루트에서 처리하세요. 필요한 파일을 직접 수정하고, 마지막 응답은 한국어로 간결하게 작성하세요.
스트리밍 응답은 사용하지 않습니다. 작업이 끝난 뒤 변경 요약, 확인한 내용, 남은 리스크만 정리하세요.
이 작업의 세션 단위는 아래 리뷰 ID입니다. 리뷰 ID가 같으면 같은 Codex 히스토리 맥락으로 이어서 처리하세요.

## 사용자 요청

맥에서 폴더 이름이 가려지고 있어. 아예 폴더 이름을 오른쪽정렬하는것도 괜찮을 것 같아.

## 리뷰 요약

- 리뷰 ID: xnopyinpvusibqdykzjjxnnzxwksqhrc
- 제목: 폴더 생성 동작 안함
- 요청 링크: http://172.16.0.143:3009
- Codex 요청자: 권태욱
- 프로젝트 루트: /Users/ktw/Documents/notedown
- Codex 세션 ID: 019ec9ec-fa96-73c2-9605-6c5cc58dec82
```

## 변경 파일 목록

- `src/app/component.nav.sidebar/view.pug`
  - 선택 폴더명 헤더를 오른쪽 정렬로 변경했다.
- `src/app/component.nav.sidebar/view.ts`
  - 정렬/검색 버튼 class의 기본 크기를 `size-8`로 줄였다.
- `devlog.md`, `devlog/2026-06-15/005-macos-folder-header-align.md`
  - 작업 이력을 추가했다.

## 검증 결과

- 첨부 스크린샷을 확인해 macOS 창 컨트롤과 선택 폴더명 겹침 위치를 기준으로 수정했다.
- `wiz_project_build(clean=false)` 성공.
- `git diff --check` 통과.
- 빌드 산출물 `build/dist/build/main.js`, `bundle/www/main.js`에서 `text-right` 헤더와 `size-8` 버튼 class가 생성된 것을 확인했다.
- 제공된 리뷰 URL `http://172.16.0.143:3009`는 현재 환경에서 연결되지 않아 실제 브라우저 렌더링 검증은 수행하지 못했다.

## 남은 리스크

- 제공 URL이 연결되지 않아 macOS 리뷰 환경에서 창 컨트롤과 폴더명 위치를 직접 재검증하지 못했다.
