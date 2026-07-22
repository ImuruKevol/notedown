!include LogicLib.nsh
!include nsDialogs.nsh
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
Var NotedownStoragePath
Var NotedownSyncServerUrl
Var NotedownSyncUsername
Var NotedownKeepBackgroundOnClose
Var NotedownLaunchAtStartup
Var NotedownIsUpdate
Var NotedownStoragePathField
Var NotedownSyncServerUrlField
Var NotedownSyncUsernameField
Var NotedownKeepBackgroundOnCloseCheckbox
Var NotedownLaunchAtStartupCheckbox

!macro customInit
  StrCpy $NotedownIsUpdate "false"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    StrCpy $NotedownIsUpdate "true"
  ${EndIf}

  DetailPrint "Checking for running Notedown processes."
  nsExec::ExecToLog 'taskkill /IM "Notedown.exe" /T'
  Pop $0
  Sleep 1500
  nsExec::ExecToLog 'taskkill /IM "Notedown.exe" /T /F'
  Pop $0

  StrCpy $NotedownStoragePath "$DOCUMENTS\Notedown Notes"
  StrCpy $NotedownSyncServerUrl ""
  StrCpy $NotedownSyncUsername ""
  StrCpy $NotedownKeepBackgroundOnClose "false"
  StrCpy $NotedownLaunchAtStartup "false"
!macroend

!macro customPageAfterChangeDir
  Page custom NotedownInitialConfigPageCreate NotedownInitialConfigPageLeave
!macroend

!macro customInstall
  ${If} $NotedownIsUpdate != "true"
    Call NotedownWriteInstallerSettings
  ${EndIf}
!macroend

Function NotedownInitialConfigPageCreate
  ${If} $NotedownIsUpdate == "true"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "저장소 디렉토리"
  Pop $0
  ${NSD_CreateText} 0 14u 76% 12u "$NotedownStoragePath"
  Pop $NotedownStoragePathField
  ${NSD_CreateBrowseButton} 79% 13u 21% 14u "찾아보기..."
  Pop $0
  ${NSD_OnClick} $0 NotedownBrowseStoragePath

  ${NSD_CreateLabel} 0 40u 100% 12u "동기화 서버 URL (선택)"
  Pop $0
  ${NSD_CreateText} 0 54u 100% 12u "$NotedownSyncServerUrl"
  Pop $NotedownSyncServerUrlField

  ${NSD_CreateLabel} 0 80u 100% 12u "동기화 사용자 이름 (선택)"
  Pop $0
  ${NSD_CreateText} 0 94u 100% 12u "$NotedownSyncUsername"
  Pop $NotedownSyncUsernameField

  ${NSD_CreateCheckbox} 0 124u 100% 12u "닫을 때 백그라운드에서 유지"
  Pop $NotedownKeepBackgroundOnCloseCheckbox
  ${If} $NotedownKeepBackgroundOnClose == "true"
    ${NSD_Check} $NotedownKeepBackgroundOnCloseCheckbox
  ${EndIf}

  ${NSD_CreateCheckbox} 0 144u 100% 12u "Windows 로그인 시 Notedown 시작"
  Pop $NotedownLaunchAtStartupCheckbox
  ${If} $NotedownLaunchAtStartup == "true"
    ${NSD_Check} $NotedownLaunchAtStartupCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function NotedownBrowseStoragePath
  ${NSD_GetText} $NotedownStoragePathField $NotedownStoragePath
  nsDialogs::SelectFolderDialog "Notedown 저장소 디렉토리 선택" "$NotedownStoragePath"
  Pop $0
  ${If} $0 != error
    StrCpy $NotedownStoragePath "$0"
    ${NSD_SetText} $NotedownStoragePathField "$NotedownStoragePath"
  ${EndIf}
FunctionEnd

Function NotedownInitialConfigPageLeave
  ${NSD_GetText} $NotedownStoragePathField $NotedownStoragePath
  ${NSD_GetText} $NotedownSyncServerUrlField $NotedownSyncServerUrl
  ${NSD_GetText} $NotedownSyncUsernameField $NotedownSyncUsername
  ${NSD_GetState} $NotedownKeepBackgroundOnCloseCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $NotedownKeepBackgroundOnClose "true"
  ${Else}
    StrCpy $NotedownKeepBackgroundOnClose "false"
  ${EndIf}
  ${NSD_GetState} $NotedownLaunchAtStartupCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $NotedownLaunchAtStartup "true"
  ${Else}
    StrCpy $NotedownLaunchAtStartup "false"
  ${EndIf}

  ${If} $NotedownStoragePath == ""
    MessageBox MB_ICONEXCLAMATION "저장소 디렉토리를 입력하세요."
    Abort
  ${EndIf}
FunctionEnd

Function NotedownWriteInstallerSettings
  CreateDirectory "$NotedownStoragePath"
  CreateDirectory "$APPDATA\Notedown"
  WriteINIStr "$APPDATA\Notedown\installer-settings.ini" "settings" "workspaceName" "Notedown"
  WriteINIStr "$APPDATA\Notedown\installer-settings.ini" "settings" "storagePath" "$NotedownStoragePath"
  WriteINIStr "$APPDATA\Notedown\installer-settings.ini" "settings" "theme" "light"
  WriteINIStr "$APPDATA\Notedown\installer-settings.ini" "settings" "editorMode" "split"
  WriteINIStr "$APPDATA\Notedown\installer-settings.ini" "settings" "keepInBackgroundOnClose" "$NotedownKeepBackgroundOnClose"
  WriteINIStr "$APPDATA\Notedown\installer-settings.ini" "settings" "launchAtStartup" "$NotedownLaunchAtStartup"
  WriteINIStr "$APPDATA\Notedown\installer-settings.ini" "settings" "syncServerUrl" "$NotedownSyncServerUrl"
  WriteINIStr "$APPDATA\Notedown\installer-settings.ini" "settings" "syncUsername" "$NotedownSyncUsername"
  WriteINIStr "$APPDATA\Notedown\installer-settings.ini" "settings" "tabSize" "2"
FunctionEnd
!endif
