# README storage sync electron build

- **ID**: 001
- **날짜**: 2026-06-30
- **유형**: 문서 업데이트, 빌드

## 작업 요약

Electron/Android 공통 저장소 형식과 서버 동기화 흐름에 맞춰 README 설명을 갱신했다.
WIZ 번들을 다시 빌드한 뒤 Electron macOS arm64/x64, Windows x64 배포 산출물을 생성했다.

## 원문 요청사항

```text
electron app도 빌드해줘.
그리고 README들도 현재 수정된 기능들에 맞게 모두 수정해줘.
```

## 변경 파일 목록

- `README.md`: Electron/Android 공통 `metadata.db`, `storagePath`, 수동 저장, 첨부/동기화 설명 갱신
- `/Users/ktw/Documents/notedown-server/README.md`: 서버 `metadata.db`, `relativePath`/`storagePath`, 첨부 API, 저장소 초기화/동기화 흐름 설명 갱신
- `devlog.md`: 작업 요약 행 추가
- `devlog/2026-06-30/001-readme-storage-sync-electron-build.md`: 작업 상세 기록 추가

## 검증

- WIZ `main` 프로젝트 빌드 성공
- `npm run dist:requested` 성공
- 생성 산출물 확인:
  - `dist/Notedown-0.2.0-mac-arm64.dmg`
  - `dist/Notedown-0.2.0-mac-arm64.zip`
  - `dist/Notedown-0.2.0-mac-x64.dmg`
  - `dist/Notedown-0.2.0-mac-x64.zip`
  - `dist/Notedown-0.2.0-win-x64.exe`
- 서버/WIZ README에서 저장소·동기화 관련 최신 키워드 반영 확인
- 서버/WIZ 저장소 `git diff --check` 통과
