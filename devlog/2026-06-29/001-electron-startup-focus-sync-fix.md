# Electron 초기 문서 로드 및 포커스 동기화 상태 갱신 보강

- **ID**: 001
- **날짜**: 2026-06-29
- **유형**: 버그 수정

## 작업 요약
Electron 앱 첫 진입에서 설정 저장 전 저장소 경로를 빈 값으로 판단해 샘플 문서/폴더가 표시되던 흐름을 수정했다.
충돌 해소 및 설정 화면 전체 동기화 성공 결과가 노트 화면과 사이드바의 전역 동기화 상태에 반영되도록 연결하고, 앱 재포커스 시 저장된 서버 정보가 있으면 전체 동기화를 실행하도록 보강했다.

## 원문 요청사항
```text
# ReviewOps Codex 작업 요청

아래 요청을 현재 프로젝트 루트에서 처리하세요. 필요한 파일을 직접 수정하고, 마지막 응답은 한국어로 간결하게 작성하세요.
스트리밍 응답은 사용하지 않습니다. 작업이 끝난 뒤 변경 요약, 확인한 내용, 남은 리스크만 정리하세요.
이 작업의 세션 단위는 아래 리뷰 ID입니다. 리뷰 ID가 같으면 같은 Codex 히스토리 맥락으로 이어서 처리하세요.

## 사용자 요청

작업 시작

## 리뷰 요약

- 리뷰 ID: zypnwcrwfrkjnxbvehuryogdohgeazll
- 제목: electron app 버그 수정 및 기능 개선
- 요청 링크: http://172.16.0.143:5500
- Codex 요청자: 권태욱
- 프로젝트 루트: /Users/ktw/Documents/notedown-server
- Codex 세션 ID: 신규
- 스크린샷 컨텍스트: 없음
- 에이전트 작업 지시서 컨텍스트: 포함됨
- HTML 문서 생성 규칙 컨텍스트: 없음
- HTML 문서 설정 컨텍스트: 없음
- HTML 프로젝트 인스트럭션 파일: 없음
- 첨부파일 컨텍스트: 0개

## 리뷰어 요청 내용

- 맥, 윈도우 둘 다 앱을 열 때 문서 목록이 바로 안불러와지고 데이터가 없을 시 뜨는 더미 폴더 및 문서가 뜨는 버그가 있음. 설정 화면을 갔다가 다시 돌아오면 정상적으로 보임.
- 충돌 동기화 후 에디터 화면으로 안넘어가고 동기화 상태가 갱신이 안됨.  설정 화면에 가서 전체 동기화를 다시 해서 성공해도 충돌 에디터만 계속 보여서 문서 편집을 못함.
- Electron app이 다시 활성화가 되었거나 장시간 사용하지 않다가 포커싱이 잡혔을 때 서버 정보가 있으면 동기화를 해야함.
```

## 변경 파일 목록
- `src/app/page.notes/view.ts`
  - Electron 저장소 API가 있을 때 샘플 문서 fallback을 막고, 설정 저장 전에도 기본 저장소 경로를 사용하도록 변경했다.
  - 전역 동기화 성공 이벤트를 받으면 파일 저장소에서 문서를 다시 읽고 충돌 뷰어를 해제하도록 보강했다.
- `src/app/component.nav.sidebar/view.ts`
  - 사이드바 문서 목록도 파일 저장소를 우선 읽고, 저장소가 빈 경우 stale localStorage 샘플 문서로 되돌아가지 않도록 수정했다.
- `src/app/layout.sidebar/view.ts`
  - Electron 창 focus/visibility 복귀 시 저장된 동기화 서버 정보가 있으면 throttled full sync를 실행하고 결과를 전역 상태로 broadcast하도록 추가했다.
- `src/app/page.settings/view.ts`
  - 설정 화면 전체 동기화 결과를 `notedown.sync.startup.result.v1`에 저장하고 `notedown:startup-sync-status` 이벤트로 노트 화면/사이드바와 동기화하도록 변경했다.
- `devlog.md`, `devlog/2026-06-29/001-electron-startup-focus-sync-fix.md`
  - 작업 요약 및 상세 devlog를 추가했다.

## 검증 결과
- `git diff --check -- src/app/page.notes/view.ts src/app/page.settings/view.ts src/app/layout.sidebar/view.ts src/app/component.nav.sidebar/view.ts` 통과.
- `wiz_project_build(clean=false)` 성공.
- 빌드 산출물 `build/dist/build/main.js`에 `runActivationSync`, `usesFileStorage`, `storeSyncResult`, `notedown:startup-sync-status` 반영을 확인했다.
- `rg`로 수정 파일 내 conflict marker가 없음을 확인했다.
- `curl -I --cookie 'season-wiz-project=main; season-wiz-devmode=true' http://172.16.0.143:3009/notes`, `/settings` 및 `curl http://172.16.0.143:5500/api/health`는 대상 서버가 리스닝하지 않아 연결 실패했다.

## 남은 리스크
- 현재 세션에서 WIZ dev 서버와 동기화 서버가 꺼져 있어 실제 Electron 런타임 포커스/충돌 해소 플로우는 수동 앱 실행으로 확인하지 못했다.
