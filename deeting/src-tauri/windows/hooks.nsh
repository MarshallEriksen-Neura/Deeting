; NSIS installer hooks for Deeting
; Custom install/uninstall logic can be added here

!include "LogicLib.nsh"

!macro NSIS_HOOK_PREINSTALL
  ; Pre-installation hook
  ; Add custom logic before installation starts
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Try to bootstrap sandbox prerequisites on Windows install.
  ; 1) Attempt WSL bootstrap when not initialized.
  ; 2) Runtime endpoint discovery is handled by the app at startup.
  DetailPrint "Bootstrapping WSL prerequisites for BoxRun..."

  IfFileExists "$SYSDIR\wsl.exe" has_wsl done_wsl
has_wsl:
  DetailPrint "Checking WSL status..."
  nsExec::ExecToLog '"$SYSDIR\wsl.exe" --status'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Attempting WSL install/bootstrap..."
    nsExec::ExecToLog '"$SYSDIR\wsl.exe" --install --no-launch'
    Pop $1
    DetailPrint "WSL bootstrap command exit code=$1"
  ${Else}
    DetailPrint "WSL already available."
  ${EndIf}

done_wsl:
!macroend
