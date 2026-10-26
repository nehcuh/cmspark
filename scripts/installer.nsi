; CMspark Windows Installer (NSIS)
; Official producer: scripts/build-windows-installer.sh
;   (called from scripts/package.sh windows-x64 after staging)
;   makensis -DPRODUCT_VERSION=x.y.z scripts/installer.nsi
; Manual: makensis -DPRODUCT_VERSION=x.y.z scripts/installer.nsi
; Requires: makensis (https://nsis.sourceforge.io/ or choco install nsis --version=3.12.0)
;
; Payload MUST be package.sh staging (node.exe + cmspark-agent.js).
; build-windows-exe.ps1 (SEA) must NOT emit this OutFile.

!define PRODUCT_NAME "CMspark"
; Prefer -DPRODUCT_VERSION= from build-windows-installer.sh; fallback must match companion/package.json.
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.7.0"
!endif
!define PRODUCT_PUBLISHER "CMspark"
!ifndef CMSPARK_STOP_SCRIPT
  !define CMSPARK_STOP_SCRIPT "..\companion\stop-installed-agent.ps1"
!endif
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

; Shared app icon for Setup and generated uninstaller.
!define MUI_ICON "..\companion\assets\cmspark.ico"
!define MUI_UNICON "..\companion\assets\cmspark.ico"

; Modern UI
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

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

; Custom finish page
!define MUI_FINISHPAGE_TITLE "Installation Complete"
!define MUI_FINISHPAGE_TEXT "CMspark is now installed.$\r$\n$\r$\nTo use CMspark, load the Chrome extension:$\r$\n$\r$\n  1. Open Chrome and go to chrome://extensions$\r$\n  2. Enable 'Developer mode' (top-right)$\r$\n  3. Click 'Load unpacked'$\r$\n  4. Select: $INSTDIR\chrome-extension$\r$\n$\r$\nThen click the CMspark icon in the Chrome toolbar to open the Side Panel."
!define MUI_FINISHPAGE_LINK "Open chrome://extensions now"
!define MUI_FINISHPAGE_LINK_LOCATION "chrome://extensions"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Start CMspark now (system tray)"
!define MUI_FINISHPAGE_RUN_FUNCTION "StartAgent"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; Stop tray + daemon whose ExecutablePath lives under $INSTDIR.
; Never use the user's shared daemon.pid here: it may belong to another install.
; Do not use WMIC (removed/optional on Windows 11 24H2+).
; Paths travel through the inherited process environment, not PowerShell source.
; Stop only this installation's agent runtimes; unrelated SEA processes survive.
!macro StopInstalledAgentUnshared
  InitPluginsDir
  File /oname=$PLUGINSDIR\cmspark-stop.ps1 "${CMSPARK_STOP_SCRIPT}"
  StrCpy $0 "$INSTDIR"
  System::Call 'Kernel32::SetEnvironmentVariable(t "CMSPARK_INSTALL_STOP_ROOT", t r0) i.r1'
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\cmspark-stop.ps1"`
  Pop $1
  System::Call 'Kernel32::SetEnvironmentVariable(t "CMSPARK_INSTALL_STOP_ROOT", p 0)'
  ${If} $1 != 0
    Abort "Could not stop this installation's processes."
  ${EndIf}
  Sleep 400
!macroend

Function StopInstalledAgent
  !insertmacro StopInstalledAgentUnshared
FunctionEnd

Function un.StopInstalledAgent
  !insertmacro StopInstalledAgentUnshared
FunctionEnd

; --- Install Section ---
Section "CMspark Agent" SecMain
  SectionIn RO

  Call StopInstalledAgent
  ; Leftover SEA from a previous local build must not stay (VBS prefers it).
  Delete "$INSTDIR\cmspark-agent.exe"

  SetOutPath "$INSTDIR"

  ; Trailing slash copies the complete tree, including extensionless files.
  File /r "..\dist-package\cmspark-windows-x64\"

  ; Write registry for Add/Remove Programs
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayIcon" '"$INSTDIR\assets\cmspark.ico",0'
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "EstimatedSize" "$0"

  ; Single autostart path - HKCU Run only (not also Startup folder).
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}" 'wscript.exe "$INSTDIR\launch-hidden.vbs"'

  ; --- Shortcuts ---
  CreateShortCut "$DESKTOP\CMspark Agent.lnk" "wscript.exe" '"$INSTDIR\launch-hidden.vbs"' "$INSTDIR\assets\cmspark.ico" 0

  !insertmacro MUI_STARTMENU_WRITE_BEGIN "StartMenu"
    CreateDirectory "$SMPROGRAMS\$START_MENU_FOLDER"
    CreateShortCut "$SMPROGRAMS\$START_MENU_FOLDER\CMspark Agent.lnk" "wscript.exe" '"$INSTDIR\launch-hidden.vbs"' "$INSTDIR\assets\cmspark.ico" 0
    CreateShortCut "$SMPROGRAMS\$START_MENU_FOLDER\Uninstall CMspark.lnk" "$INSTDIR\uninstall.exe"
  !insertmacro MUI_STARTMENU_WRITE_END

  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; --- Uninstall Section ---
Section "Uninstall"
  Call un.StopInstalledAgent

  nsExec::ExecToLog 'schtasks /delete /tn "cmspark-companion" /f'

  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"

  Delete "$DESKTOP\CMspark Agent.lnk"
  Delete "$SMSTARTUP\CMspark Agent.lnk"
  !insertmacro MUI_STARTMENU_GETFOLDER "StartMenu" $0
  Delete "$SMPROGRAMS\$0\CMspark Agent.lnk"
  Delete "$SMPROGRAMS\$0\Uninstall CMspark.lnk"
  RMDir "$SMPROGRAMS\$0"

  DeleteRegKey HKCU "${PRODUCT_UNINST_KEY}"

  RMDir /r "$INSTDIR"
SectionEnd

; --- Custom function: start tray agent ---
Function StartAgent
  Exec 'wscript.exe "$INSTDIR\launch-hidden.vbs"'
FunctionEnd
