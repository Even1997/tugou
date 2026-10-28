; Never let NSIS terminate another open project, including preview profiles.
!macro customCheckAppRunning
  StrCpy $R1 30
  ${Do}
    nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    ${If} $R0 != 0
      ${ExitDo}
    ${EndIf}
    Sleep 100
    IntOp $R1 $R1 - 1
  ${LoopWhile} $R1 > 0
  ${If} $R0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "请先保存并关闭所有土狗窗口，再重新运行安装程序。$\r$\nSave and close all Tugou windows, then run setup again." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend
