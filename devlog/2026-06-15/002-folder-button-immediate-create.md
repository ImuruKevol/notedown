# 새 폴더 버튼 즉시 생성 방식으로 보강

- **ID**: 002
- **날짜**: 2026-06-15
- **유형**: 버그 수정

## 작업 요약

새 폴더 버튼이 네이티브 prompt에 의존하던 흐름을 제거하고, 클릭 즉시 `새 폴더`, `새 폴더 2` 형식의 폴더가 목록에 추가되도록 변경했다.
버튼에 `app-no-drag`를 명시해 드래그 영역 설정과 겹치더라도 클릭 이벤트가 전달되도록 보강했다.

## 원문 요청사항

```text
# ReviewOps Codex 작업 요청

아래 요청을 현재 프로젝트 루트에서 처리하세요. 필요한 파일을 직접 수정하고, 마지막 응답은 한국어로 간결하게 작성하세요.
스트리밍 응답은 사용하지 않습니다. 작업이 끝난 뒤 변경 요약, 확인한 내용, 남은 리스크만 정리하세요.
이 작업의 세션 단위는 아래 리뷰 ID입니다. 리뷰 ID가 같으면 같은 Codex 히스토리 맥락으로 이어서 처리하세요.

## 사용자 요청

+ 버튼을 눌러도 아무 반응이 없어.

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
  - 새 폴더 버튼에 `app-no-drag` 클래스를 추가했다.
- `src/app/component.nav.sidebar/view.ts`
  - prompt 입력 방식 대신 클릭 즉시 고유한 기본 폴더명을 생성하도록 변경했다.
  - 기존 폴더명과 충돌하면 `새 폴더 2`, `새 폴더 3` 순서로 생성되도록 했다.
- `devlog.md`, `devlog/2026-06-15/002-folder-button-immediate-create.md`
  - 추가 보강 작업 이력을 남겼다.

## 검증 결과

- `wiz_project_build(clean=false)` 성공.
- `git diff --check` 통과.
- 빌드 산출물 `build/dist/build/main.js`, `bundle/www/main.js`에서 `createFolder()`가 prompt 없이 `nextFolderLabel()`을 호출하는 것을 확인했다.
- 제공된 리뷰 URL `http://172.16.0.143:3009`는 현재 환경에서 연결되지 않아 실제 브라우저 클릭 검증은 수행하지 못했다.

## 남은 리스크

- 제공 URL이 연결되지 않아 리뷰 환경에서의 클릭 동작은 직접 확인하지 못했다.
