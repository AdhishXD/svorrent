# Windows main-commit updates

The `main-windows-snapshot.yml` workflow builds an NSIS installer for each commit on upstream `main`. It signs both the launcher and installer, then uploads `Svorrent-<full commit SHA>-Setup.exe` to the `main-windows-snapshot` prerelease. The app only offers the installer whose SHA matches the current upstream `main` commit.

The maintainer must configure these repository Actions secrets before publishing can succeed:

- `WINDOWS_CERTIFICATE_PFX_BASE64`: Base64 content of a trusted Windows code-signing PFX.
- `WINDOWS_CERTIFICATE_PASSWORD`: Password for that PFX.

The workflow refuses to publish an unsigned installer. The updater verifies the GitHub asset SHA-256 digest and the Authenticode signer thumbprint pinned in the installed build. It waits for Svorrent to exit before running the silent installer, then reopens the app. The build is installed per-user under `%LOCALAPPDATA%\Programs\Svorrent`; other locations require a manual install.

An older Windows app without a pinned signing certificate cannot install a main snapshot automatically. After the first signed snapshot is available, install it manually once. Subsequent signed snapshots can update in place, provided they use the same signing certificate. If the certificate changes, distribute a manually installed transition build.

Versioned releases also build a signed Windows installer and portable archive from the same tag as the macOS DMG. The release is published only after both platforms build and the synthetic transfer tests pass. The automated build needs NSIS, Visual C++ build tools, Node.js 22.12 or newer, and the repository's npm dependencies. The user machine still needs Node.js to run the current Windows launcher.
