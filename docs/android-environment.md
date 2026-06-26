# Android Environment

Notedown now has a Capacitor Android app that loads the same WIZ/Angular bundle used by Electron from `bundle/www`.

## Prerequisites

- Node.js and npm installed for the existing WIZ/Electron project.
- Android Studio installed.
- Android SDK Platform 36 installed through Android Studio SDK Manager.
- Android SDK Build-Tools 35 or newer. Gradle can install missing SDK packages when Android SDK licenses are accepted and the SDK directory is writable.
- JDK 17 or newer available to Gradle. Android Studio's embedded JDK is recommended when local Java versions drift.

The local SDK path is generated into `android/local.properties` by Capacitor/Android Studio and is intentionally ignored by Git.

## Commands

Run from `project/main`.

```bash
npm install
npm run android:sync
npm run android:open
npm run android:build:debug
```

Use `npm run android:run` after an emulator or device is available.

## Project Layout

```text
project/main/
├── capacitor.config.json
├── src/angular/app/notedown-android-bridge.ts
└── android/
    ├── app/src/main/AndroidManifest.xml
    ├── app/src/main/java/com/notedown/app/MainActivity.java
    ├── app/src/main/java/com/notedown/app/NotedownNativePlugin.java
    ├── app/src/main/res/xml/network_security_config.xml
    ├── app/src/main/res/xml/file_paths.xml
    └── gradlew
```

Generated Android files under `android/app/src/main/assets/`, `android/app/src/main/res/xml/config.xml`, `android/capacitor-cordova-android-plugins/`, and `android/local.properties` are ignored and should be regenerated with `npm run android:sync`.

## Permissions And Network Policy

The initial Android shell declares these permissions:

- `INTERNET`: required for server sync and health checks.
- `ACCESS_NETWORK_STATE`: useful for sync availability checks.
- `READ_EXTERNAL_STORAGE` up to Android 12L and `WRITE_EXTERNAL_STORAGE` up to Android 9 for legacy file access.
- `READ_MEDIA_IMAGES` for Android 13+ image attachment selection.

The app does not request broad all-files access. Android note storage, arbitrary file attachments, and PDF export should be implemented with the Android Storage Access Framework in the native bridge instead of `MANAGE_EXTERNAL_STORAGE`.

Cleartext HTTP is denied by default. It is allowed only for current local development and sync hosts in `network_security_config.xml`: `172.16.0.143`, `10.0.2.2`, `127.0.0.1`, and `localhost`.

## Android Native Bridge

`NotedownNativePlugin` is registered from `MainActivity` and is exposed to the Angular app through `src/angular/app/notedown-android-bridge.ts` as `window.notedown` on Capacitor Android.

The bridge currently supports:

- app preferences used by the settings screen.
- app-specific note storage under Android external files Documents, with a default `Notedown Notes` directory.
- storage status, initialization, Markdown note loading, Markdown note saving, and `metadata.json` updates.
- arbitrary attachment picking through Android's document picker, attachment save/open using app-specific storage and `FileProvider` read URIs.
- sync server health check, setup status, setup, login, plan, full sync, per-note upload, conflict file read, and conflict resolution.
- `.notedown-sync.json` manifest state tracking in the Android note storage directory.
- Android PDF export through the system create-document flow and native `PdfDocument` rendering.

## Current Limits

Android does not request broad all-files access. The directory picker asks the system for a folder and persists the URI for future extension, but the note storage path still resolves to the app-specific Documents directory because the current Markdown storage engine is path-based. Full arbitrary shared-folder storage would require a Storage Access Framework-backed storage adapter for every read/write/list/delete operation.

Desktop tray/status-bar behavior remains Electron-only because Android has a different app lifecycle model. The Android app keeps the setting API for compatibility, but it does not create a desktop-style tray.
