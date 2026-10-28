Target x86-ansi
!include "MUI2.nsh"
!ifndef SVORRENT_VERSION
    !error "SVORRENT_VERSION must be supplied by the package builder"
!endif

Name "Svorrent"
Caption "Svorrent Setup"
OutFile "Svorrent-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Svorrent"
InstallDirRegKey HKCU "Software\Svorrent" "InstallPath"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ICON "svorrent.ico"
!define MUI_UNICON "svorrent.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\Svorrent.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Svorrent"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Svorrent Core" SecCore
    SetOutPath "$INSTDIR"
    File /r "staging\*"

    CreateDirectory "$SMPROGRAMS\Svorrent"
    CreateShortcut "$SMPROGRAMS\Svorrent\Svorrent.lnk" "$INSTDIR\Svorrent.exe" "" "$INSTDIR\Svorrent.exe" 0
    CreateShortcut "$SMPROGRAMS\Svorrent\Uninstall Svorrent.lnk" "$INSTDIR\Uninstall.exe"
    CreateShortcut "$DESKTOP\Svorrent.lnk" "$INSTDIR\Svorrent.exe" "" "$INSTDIR\Svorrent.exe" 0

    WriteRegStr HKCU "Software\Svorrent" "InstallPath" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Svorrent" "DisplayName" "Svorrent"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Svorrent" "DisplayIcon" "$INSTDIR\Svorrent.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Svorrent" "UninstallString" "$INSTDIR\Uninstall.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Svorrent" "DisplayVersion" "${SVORRENT_VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Svorrent" "Publisher" "Svorrent Team"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Svorrent" "HelpLink" "https://github.com/sovopr/svorrent"

    WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
    Delete "$DESKTOP\Svorrent.lnk"
    RMDir /r "$SMPROGRAMS\Svorrent"
    RMDir /r "$INSTDIR"

    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Svorrent"
    DeleteRegKey HKCU "Software\Svorrent"
SectionEnd
