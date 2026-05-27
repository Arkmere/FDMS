; NSIS installer hooks for Vectair Flite
;
; === Background ===
;
; NSIS_HOOK_POSTINSTALL runs inside Section Install, BEFORE the MUI Finish
; page is shown.  In interactive (non-passive, non-silent) mode, the Tauri
; template does NOT create the desktop shortcut in Section Install at all:
;
;   ${If} $PassiveMode = 1
;   ${OrIf} ${Silent}
;     Call CreateOrUpdateDesktopShortcut   ; only for passive/silent
;   ${EndIf}
;   !insertmacro NSIS_HOOK_POSTINSTALL     ; our hook runs here
;
; Instead, the desktop shortcut is created by the Finish page's
; "Create desktop shortcut" checkbox callback:
;
;   !define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut
;
; This callback fires AFTER Section Install completes, so without this hook
; the Finish page would call CreateShortcut without the icon arg, leaving
; IconLocation as ",0".
;
; === Fix ===
;
; 1. Create the desktop shortcut with an explicit icon in NSIS_HOOK_POSTINSTALL.
; 2. Set $NoShortcutMode = 1.  CreateOrUpdateDesktopShortcut checks this flag:
;
;      ${If} $UpdateMode = 1
;      ${OrIf} $NoShortcutMode = 1
;        Return
;      ${EndIf}
;
;    With $NoShortcutMode = 1 the Finish page callback returns early and
;    cannot overwrite our explicit-icon shortcut.
; 3. Recreate the Start Menu shortcut (created just before this hook runs)
;    with the same explicit icon.

!macro NSIS_HOOK_POSTINSTALL
  ; --- Start Menu shortcut ---
  ; CreateOrUpdateStartMenuShortcut was called just above this hook in
  ; Section Install; $AppStartMenuFolder is set by MUI_STARTMENU_WRITE_BEGIN.
  ${If} $AppStartMenuFolder != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  ${EndIf}

  ; --- Desktop shortcut ---
  ; In interactive mode the desktop shortcut has not been created yet at this
  ; point — the Finish page creates it after Section Install.  We create it
  ; here with an explicit icon and then set $NoShortcutMode = 1 so that
  ; CreateOrUpdateDesktopShortcut (called by the Finish page "Create desktop
  ; shortcut" checkbox) returns early and does not overwrite our shortcut.
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  StrCpy $NoShortcutMode 1
!macroend
