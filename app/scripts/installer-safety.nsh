!macro customCheckAppRunning
  InitPluginsDir
  File /oname=$PLUGINSDIR\close-installed-tugou.ps1 "${PROJECT_DIR}\scripts\close-installed-tugou.ps1"
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $3 "$PowerShellPath"
  ; NSIS is 32-bit. Use native PowerShell so Get-Process can read the 64-bit app path.
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy $3 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  StrCpy $0 ""
  StrCpy $1 ""
  !ifndef BUILD_UNINSTALLER
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $installMode == "all"
      ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}
  !endif
  System::Call 'kernel32::SetEnvironmentVariableW(w "TUGOU_SETUP_PREVIOUS_DIR", w r0)i'
  System::Call 'kernel32::SetEnvironmentVariableW(w "TUGOU_SETUP_USER_DIR", w r1)i'
  ${Do}
    nsExec::Exec /TIMEOUT=45000 '"$3" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\close-installed-tugou.ps1" -Executable "$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    Pop $2
    ${If} $2 == 0
      ${ExitDo}
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "土狗还在运行，或无法确认它已退出。请保存工程并关闭旧版土狗，然后点击重试。" /SD IDCANCEL IDRETRY +3
    SetErrorLevel 2
    Quit
  ${Loop}
  System::Call 'kernel32::SetEnvironmentVariableW(w "TUGOU_SETUP_PREVIOUS_DIR", p 0)i'
  System::Call 'kernel32::SetEnvironmentVariableW(w "TUGOU_SETUP_USER_DIR", p 0)i'
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
