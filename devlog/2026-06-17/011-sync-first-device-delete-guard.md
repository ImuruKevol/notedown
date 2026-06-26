# 새 기기 첫 동기화 서버 삭제 방지 및 tombstone 조건 보강

## 요청

- 리뷰 ID: `frzbyrdvqagprbzelzuvhqxhqpwctuqc`
- 원문 요청: "작업 시작.
electron app과 android 모두 적용이 되어야 해."
- 상세 요청: 새 기기 첫 동기화에서 Android가 서버 기존 파일을 삭제 처리하지 않도록, 클라이언트 knownFiles/knownAttachments와 deleted/tombstone 전송 조건을 보강한다.

## 변경 파일

- `electron/main.cjs`: 첫 동기화에서 knownFiles/knownAttachments를 비우고, 서버 삭제는 lastKnownRevision이 있는 tombstone 또는 명시 삭제 요청에서만 `deleted: true`를 보내도록 보강
- `src/angular/app/notedown-android-bridge.ts`: Android 브리지에도 동일한 first-sync, tombstone, JSON boolean deleted 처리 적용
- `devlog.md`, `devlog/2026-06-17/011-sync-first-device-delete-guard.md`: 작업 로그 추가

## 확인

- `node --check electron/main.cjs`: 성공
- `wiz_project_build`: 성공
- `npm run android:build:debug`: 성공
- 참고: `npm --prefix src/angular run build -- --configuration production`은 로컬 `@angular-devkit/build-angular` 패키지 부재로 실패했으며, WIZ 빌드는 성공했다.

## 판단

- `.notedown-sync.json`에 서버 revision 또는 lastKnownRevision 이력이 없는 새 기기 첫 동기화에서는 파일 목록을 서버 삭제 판단 근거로 보내지 않는다.
- 일반 업로드에서는 `deleted` 필드를 생략하고, 삭제 시에만 JSON boolean `true`를 포함한다.
- 서버 삭제 요청은 lastKnownRevision이 없으면 보내지 않도록 차단한다.
