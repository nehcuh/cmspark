; CMspark Windows Installer (NSIS)
; Build: makensis scripts/installer.nsi
; Requires: makensis (brew install makensis)

!define PRODUCT_NAME "CMspark"
!define PRODUCT_VERSION "0.2.0"
!define PRODUCT_PUBLISHER "CMspark"
!define PRODUCT_EXE "cmspark-agent.exe"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

; Modern UI
!include "MUI2.nsh"
!include "FileFunc.nsh"

; Installer settings
Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "..\dist-package\CMspark-Setup-v${PRODUCT_VERSION}.exe"
InstallDir "$LOCALAPPDATA\${PRODUCT_NAME}"
RequestExecutionLevel user
SetCompressor /SOLID lzma

; Variables
Var /GLOBAL START_MENU_FOLDER

; --- Pages ---
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_STARTMENU "StartMenu" $START_MENU_FOLDER
!insertmacro MUI_PAGE_INSTFILES

; Custom finish page with Chrome extension instructions
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TEXT "CMspark Agent is now installed and will start automatically.$\r$\n$\r$\nTo use CMspark, you need to load the Chrome extension:$\r$\n$\r$\n  1. Open Chrome and go to chrome://extensions$\r$\n  2. Enable 'Developer mode' (top-right)$\r$\n  3. Click 'Load unpacked'$\r$\n  4. Select the folder: $INSTDIR\chrome-extension$\r$\n$\r$\nThen click the CMspark icon in Chrome toolbar to open Side Panel."
!define MUI_FINISHPAGE_LINK "Open chrome://extensions now"
!define MUI_FINISHPAGE_LINK_LOCATION "chrome://extensions"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Start CMspark Agent now"
!define MUI_FINISHPAGE_RUN_FUNCTION "StartAgent"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; --- Install Section ---
Section "CMspark Agent" SecMain
  SectionIn RO

  SetOutPath "$INSTDIR"

  ; Write files from staging directory (relative to script location)
  File /r "..\dist-package\cmspark-windows-x64\*.*"

  ; Rename node.exe (downloaded as node.exe, already correct)

  ; Register auto-start via Task Scheduler
  ; Use a helper PS1 to avoid NSIS variable conflicts with PowerShell $
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\install-daemon.ps1"'

  ; Write registry for Add/Remove Programs
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "EstimatedSize" "$0"

  ; Create shortcuts
  !insertmacro MUI_STARTMENU_WRITE_BEGIN "StartMenu"
    CreateDirectory "$SMPROGRAMS\$START_MENU_FOLDER"
    CreateShortCut "$SMPROGRAMS\$START_MENU_FOLDER\CMspark Agent.lnk" "$INSTDIR\node.exe" "cmspark-agent.js tray" "$INSTDIR\node.exe" 0
    CreateShortCut "$SMPROGRAMS\$START_MENU_FOLDER\CMspark Tray (Background).lnk" "$INSTDIR\node.exe" "cmspark-agent.js daemon start" "$INSTDIR\node.exe" 0
    CreateShortCut "$SMPROGRAMS\$START_MENU_FOLDER\Uninstall CMspark.lnk" "$INSTDIR\uninstall.exe"
  !insertmacro MUI_STARTMENU_WRITE_END

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; --- Uninstall Section ---
Section "Uninstall"
  ; Stop and remove scheduled task
  nsExec::ExecToLog 'powershell -NoProfile -Command "Stop-ScheduledTask -TaskName cmspark-companion -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName cmspark-companion -Confirm:0 -ErrorAction SilentlyContinue"'

  ; Remove shortcuts
  !insertmacro MUI_STARTMENU_GETFOLDER "StartMenu" $0
  Delete "$SMPROGRAMS\$0\CMspark Agent.lnk"
  Delete "$SMPROGRAMS\$0\CMspark Tray (Background).lnk"
  Delete "$SMPROGRAMS\$0\Uninstall CMspark.lnk"
  RMDir "$SMPROGRAMS\$0"

  ; Remove registry
  DeleteRegKey HKCU "${PRODUCT_UNINST_KEY}"

  ; Remove files
  RMDir /r "$INSTDIR\chrome-extension"
  RMDir /r "$INSTDIR\node_modules"
  RMDir /r "$INSTDIR\builtin-skills"
  RMDir /r "$INSTDIR\assets"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\cmspark-agent.js"
  Delete "$INSTDIR\sql-wasm.wasm"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\install.bat"
  Delete "$INSTDIR\launch.bat"
  Delete "$INSTDIR\uninstall.bat"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd

; --- Custom function: start agent ---
Function StartAgent
  nsExec::ExecToLog '"$INSTDIR\node.exe" "$INSTDIR\cmspark-agent.js" daemon start'
FunctionEnd
