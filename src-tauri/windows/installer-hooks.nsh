; The stock Tauri NSIS template owns data-removal opt-in and Run-key cleanup.
; Stop the GUI and its elevated core gracefully before replacing/removing files.
!macro ClearTierGracefulShutdown
  !define ClearTierShutdownID ${__LINE__}
  FindWindow $R4 "${BUNDLEID}-sic" "${BUNDLEID}-siw"
  ${If} $R4 <> 0
    IfSilent cleartier_stop_${ClearTierShutdownID} 0
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "ClearTier will disconnect all networks before setup continues.$\n继续安装或卸载将断开 ClearTier 的所有网络连接。" IDOK cleartier_stop_${ClearTierShutdownID} IDCANCEL cleartier_cancel_${ClearTierShutdownID}
    cleartier_cancel_${ClearTierShutdownID}:
      Abort
    cleartier_stop_${ClearTierShutdownID}:
      IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 cleartier_timeout_${ClearTierShutdownID}
      ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --installer-shutdown' $R5
      StrCpy $R6 0
    cleartier_wait_${ClearTierShutdownID}:
      FindWindow $R4 "${BUNDLEID}-sic" "${BUNDLEID}-siw"
      ${If} $R4 = 0
        Goto cleartier_done_${ClearTierShutdownID}
      ${EndIf}
      Sleep 100
      IntOp $R6 $R6 + 1
      ${If} $R6 < 250
        Goto cleartier_wait_${ClearTierShutdownID}
      ${EndIf}
    cleartier_timeout_${ClearTierShutdownID}:
      Abort "ClearTier is still running. Exit it and retry setup. / 请先退出 ClearTier 后重试。"
  ${EndIf}
  cleartier_done_${ClearTierShutdownID}:
  !undef ClearTierShutdownID
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ClearTierGracefulShutdown
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ClearTierGracefulShutdown
!macroend
