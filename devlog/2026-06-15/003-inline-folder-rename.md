# 폴더 이름 인라인 수정 기능 추가

- **ID**: 003
- **날짜**: 2026-06-15
- **유형**: 기능 추가

## 작업 요약

폴더 목록의 각 폴더에 이름 수정 버튼을 추가하고, 클릭하면 해당 행에서 바로 이름을 편집할 수 있도록 했다.
Enter 또는 blur로 저장하고 Escape로 취소하며, 변경된 폴더명은 저장된 폴더 목록과 해당 폴더의 노트 `workspaceName`에 반영된다.

## 원문 요청사항

```text
# ReviewOps Codex 작업 요청

아래 요청을 현재 프로젝트 루트에서 처리하세요. 필요한 파일을 직접 수정하고, 마지막 응답은 한국어로 간결하게 작성하세요.
스트리밍 응답은 사용하지 않습니다. 작업이 끝난 뒤 변경 요약, 확인한 내용, 남은 리스크만 정리하세요.
이 작업의 세션 단위는 아래 리뷰 ID입니다. 리뷰 ID가 같으면 같은 Codex 히스토리 맥락으로 이어서 처리하세요.

## 사용자 요청

노트의 경우엔 노트 이름을 수정할 수 있는 방법이 있는데, 폴더는 이름을 수정할 수 있는 방법이 없어.

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
  - 폴더 행에 이름 수정 버튼과 인라인 입력 상태를 추가했다.
  - 폴더명 입력은 Enter 저장, Escape 취소, blur 저장 이벤트를 처리한다.
- `src/app/component.nav.sidebar/view.ts`
  - 폴더명 편집 상태, 시작/취소/저장 로직을 추가했다.
  - 폴더명 중복 시 숫자 suffix를 붙이고, 변경된 이름을 저장 폴더 목록과 기존 노트의 `workspaceName`에 반영한다.
  - 편집 버튼을 항상 식별 가능한 낮은 opacity 아이콘 버튼으로 노출했다.
- `devlog.md`, `devlog/2026-06-15/003-inline-folder-rename.md`
  - 작업 이력을 추가했다.

## 검증 결과

- `wiz_project_build(clean=false)` 성공.
- `git diff --check` 통과.
- 빌드 산출물 `build/dist/build/main.js`, `bundle/www/main.js`에서 `startFolderRename`, `commitFolderRename`, `folderEditButtonClass` 및 입력 바인딩이 생성된 것을 확인했다.
- 제공된 리뷰 URL `http://172.16.0.143:3009`는 현재 환경에서 연결되지 않아 실제 브라우저 클릭 검증은 수행하지 못했다.

## 남은 리스크

- 제공 URL이 연결되지 않아 리뷰 환경에서의 인라인 편집 동작은 직접 확인하지 못했다.
