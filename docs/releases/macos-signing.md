# macOS release signing

Downloaded macOS apps need a valid Developer ID signature and Apple notarization
to pass Gatekeeper. A checksum confirms the DMG is intact, but does not replace
these checks. `scripts/build-dmg.sh` signs the complete app bundle after all
resources have been copied. Local builds use an ad hoc signature; they are for
development and are not suitable as public download assets.

Before publishing a version tag, configure these GitHub Actions secrets in the
upstream repository:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64 of the exported Developer ID Application `.p12` certificate and private key |
| `MACOS_CERTIFICATE_PASSWORD` | Password protecting that `.p12` file |
| `MACOS_SIGNING_IDENTITY` | Full Developer ID Application identity used by `codesign` |
| `MACOS_KEYCHAIN_PASSWORD` | Temporary CI keychain password |
| `APPLE_ID` | Apple ID authorized to notarize for the team |
| `APPLE_TEAM_ID` | Apple Developer team identifier |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |

The release workflow imports the certificate into a temporary keychain, signs
the app and embedded native code with hardened runtime, submits the DMG with
`notarytool`, staples the accepted ticket, and only then publishes the DMG and
its checksum. Missing credentials or a rejected notarization fails the workflow
before a release asset is uploaded.
