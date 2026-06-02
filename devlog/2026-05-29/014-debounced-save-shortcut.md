# 노트 자동 저장 debounce 및 저장 단축키 추가

## 요청

ReviewOps `aidnaojehibaqbvjhbtlxcoiakmoxbuv` - 파일 저장 시 자동 동기화는 맞지만, 파일 자동 저장 로직을 입력 후 몇 초 동안 변경이 없을 때 저장하는 방식으로 개선하고, macOS에서는 `cmd+s`, Windows에서는 `ctrl+s`로 저장할 수 있게 해달라는 요청.

## 변경 파일

- `src/app/page.notes/view.ts`
- `devlog.md`
- `devlog/2026-05-29/014-debounced-save-shortcut.md`

## 변경 내용

- 본문/제목/체크리스트 변경 시 즉시 파일 저장하지 않고, preview와 메모리 상태만 갱신한 뒤 2.5초 동안 추가 변경이 없을 때 저장하도록 debounce 저장 타이머를 추가했다.
- `saveNow()` 단일 저장 진입점을 추가해 자동 저장, 노트 전환 전 저장, 수동 단축키 저장이 같은 저장/동기화 흐름을 타도록 했다.
- window keydown capture와 Monaco editor action에 `Cmd/Ctrl+S` 저장 단축키를 등록했다.
- 컴포넌트 종료 전에는 남은 변경사항을 로컬 저장만 수행해 pending debounce가 파일 손실로 이어지지 않게 했다.

## 검증

- `git diff --check -- src/app/page.notes/view.ts` 성공.
- `node --check electron/main.cjs && node --check electron/preload.cjs` 성공.
- `wiz_project_build(clean=false)` 성공.
- 요청 링크 `http://172.16.0.143:3009/notes`에 `season-wiz-project=main`, `season-wiz-devmode=true` 쿠키를 포함한 HTTP 검증에서 200 OK 및 최신 빌드 산출물 응답을 확인했다.
- `curl http://172.16.0.143:5500/api/health` 결과 `{"status":"ok"}` 확인.
