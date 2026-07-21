# 체크박스 진행률 및 프리뷰-에디터 동기화 오류 수정

- **ID**: 001
- **날짜**: 2026-07-21
- **유형**: 버그 수정
- **리뷰 ID**: nfhzvczchcfhmybzrrdydxsjpaudedim

## 작업 요약

수동 저장 전에는 사이드바가 저장된 노트 본문만 사용해 체크리스트 진행률이 이전 값으로 남던 문제를 수정했다.
프리뷰의 체크박스와 내용 클릭을 동일한 원문 기반 토글 경로로 통합하고, 에디터 및 사이드바 렌더 갱신을 명시했다.

## 원문 요청사항

```text
# ReviewOps Codex 작업 요청

아래 요청을 현재 프로젝트 루트에서 처리하세요. 필요한 파일을 직접 수정하고, 마지막 응답은 한국어로 간결하게 작성하세요.
스트리밍 응답은 사용하지 않습니다. 작업이 끝난 뒤 변경 요약, 확인한 내용, 남은 리스크만 정리하세요.
이 작업의 세션 단위는 아래 리뷰 ID입니다. 리뷰 ID가 같으면 같은 Codex 히스토리 맥락으로 이어서 처리하세요.

## 사용자 요청

작업 시작

## 리뷰 요약

- 리뷰 ID: nfhzvczchcfhmybzrrdydxsjpaudedim
- 제목: 체크박스 관련 오류
- 요청 링크: http://172.16.0.143:5500
- Codex 요청자: 권태욱
- 프로젝트 루트: /Users/ktw/Documents/notedown-server
- Codex 세션 ID: 신규
- Codex 모델: 5.6 sol (gpt-5.6-sol)
- Codex 추론수준: max (max)
- 스크린샷 컨텍스트: 없음
- 에이전트 작업 지시서 컨텍스트: 포함됨
- HTML 문서 생성 규칙 컨텍스트: 없음
- HTML 문서 설정 컨텍스트: 없음
- HTML 프로젝트 인스트럭션 파일: 없음
- 첨부파일 컨텍스트: 0개

## 에이전트 작업 지시서

# 에이전트 작업 지시서

## 리뷰 정보

- 리뷰 ID: nfhzvczchcfhmybzrrdydxsjpaudedim
- 제목: 체크박스 관련 오류
- 상태: open
- 우선순위: normal
- 분류: ux
- 프로젝트: Notedown Server
- 프로젝트 종류: web_service
- 요청 링크: http://172.16.0.143:5500
- 화면: 1440x900
- 캡처 방식: browser-display-capture-element
- 스크린샷 첨부: yes
- 리뷰 첨부 파일: 0개

## 리뷰어 요청 내용

electron 앱에서 체크박스 (todo) 관련 에러가 있음.
- todo를 여러 개 만들어놓고 하나만 체크해도 왼쪽 노트 목록에서 100%라고 찍힘.
- preview 패널에서 체크박스/내용 을 클릭해도 에디터 부분에 체크가 반영되지 않음.

## 첨부 파일

-

## 콘솔 로그 요약

-

## 네트워크 로그 요약

-

## 환경 로그 요약

- browser-fingerprint: MacIntel / ko-KR / 2560x1440
- iframe-fingerprint: restricted / http://172.16.0.143:5500
- iframe-fingerprint: restricted / http://172.16.0.143:5500
- browser-fingerprint: MacIntel / ko-KR / 2560x1440
- iframe-fingerprint: restricted / http://172.16.0.143:5500
- reviewops-sdk: SDK missing
- browser-fingerprint: MacIntel / ko-KR / 2560x1440
- iframe-fingerprint: restricted / http://172.16.0.143:5500
```

## 변경 파일 목록

- src/app/page.notes/view.ts
  - 미저장 본문 변경을 note-body-changed 이벤트로 알리도록 추가.
  - 프리뷰 체크박스와 내용 클릭을 원문 상태 기준 단일 토글 경로로 통합.
  - 체크 상태 변경 후 페이지 렌더 갱신을 명시.
- src/app/component.nav.sidebar/view.ts
  - 미저장 본문 이벤트를 받아 체크리스트 진행률을 즉시 재계산.
  - 대시, 별표, 플러스, 번호 목록 체크리스트 문법을 동일하게 집계.
- devlog.md
- devlog/2026-07-21/001-checkbox-progress-preview-sync.md

## 검증 결과

- WIZ normal build 성공: wiz_project_build(projectName="main", clean=false).
- 변경 전, 저장된 체크리스트 1개가 완료된 상태에서 미저장 체크리스트 2개를 추가하면 사이드바가 100%로 남는 현상을 재현.
- 변경 번들을 Playwright로 검증해 미저장 편집 직후 진행률이 100%에서 33%로 갱신되는 것을 확인.
- 프리뷰 체크박스 클릭 시 에디터가 [ ]에서 [x]로 바뀌고 진행률이 33%에서 67%로 갱신되는 것을 확인.
- 프리뷰 내용 클릭 시에도 에디터와 진행률이 동일하게 갱신되는 것을 확인.
- 대시(-), 플러스(+), 번호(1.) 체크리스트 3개 중 1개 완료가 33%로 계산되고 번호 항목 클릭 후 67%로 갱신되는 것을 확인.
- UI 검증에 season-wiz-project=main, season-wiz-devmode=true 쿠키를 적용.
- 정적 검증 서버의 콘솔 오류 2건은 백엔드가 없는 환경의 /auth/check HTTP 501뿐이며 체크박스 동작 관련 런타임 오류는 없었음.

## 남은 리스크

- 리뷰 요청 링크 http://172.16.0.143:5500 은 연결되지 않아 WIZ 빌드 산출물을 로컬 정적 서버에서 검증했다.
- Electron 배포 패키지는 이번 버그 수정 범위에서 재생성하지 않았다.
