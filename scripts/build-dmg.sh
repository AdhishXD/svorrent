#!/usr/bin/env bash
set -e

# ==============================================================================
# Svorrent macOS .app & .dmg Builder
# Creates a lightweight native launcher that opens Svorrent in the default browser.
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/dist-app"
APP_BUNDLE="$BUILD_DIR/Svorrent.app"
DMG_STAGING="$BUILD_DIR/dmg-staging"
DMG_OUTPUT="$BUILD_DIR/Svorrent.dmg"

echo "==> Building Android USB tethering helper..."
NATIVE_DIR="$BUILD_DIR/native"
mkdir -p "$NATIVE_DIR"
CXX="${SVORRENT_CXX:-/Library/Developer/CommandLineTools/usr/bin/clang++}"
SDK="${SVORRENT_SDK:-/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk}"
OTOOL="${SVORRENT_OTOOL:-/Library/Developer/CommandLineTools/usr/bin/otool}"
INSTALL_NAME_TOOL="${SVORRENT_INSTALL_NAME_TOOL:-/Library/Developer/CommandLineTools/usr/bin/install_name_tool}"
if [ ! -x "$CXX" ] || [ ! -d "$SDK" ] || [ ! -x "$OTOOL" ] || [ ! -x "$INSTALL_NAME_TOOL" ]; then
    echo "A macOS C++ toolchain and SDK are required to build Android USB support." >&2
    exit 1
fi
"$CXX" -isysroot "$SDK" -mmacosx-version-min=26.0 -O2 -std=c++17 -Wall -Wextra \
    "$ROOT_DIR/backend/tether/svorrent-tetherd.cc" \
    -L"$ROOT_DIR/backend/bin" -ltetherkit \
    -o "$NATIVE_DIR/svorrent-tetherd"
TETHER_LIBRARY="$("$OTOOL" -L "$NATIVE_DIR/svorrent-tetherd" | awk '/libtetherkit\.0\.dylib/{print $1; exit}')"
if [ -z "$TETHER_LIBRARY" ]; then
    echo "The native helper did not link against TetherKit." >&2
    exit 1
fi
"$INSTALL_NAME_TOOL" -change "$TETHER_LIBRARY" \
    '@executable_path/libtetherkit.0.dylib' "$NATIVE_DIR/svorrent-tetherd"
codesign --force --sign - "$NATIVE_DIR/svorrent-tetherd"
cp -a "$ROOT_DIR/backend/bin"/libtetherkit*.dylib "$ROOT_DIR/backend/bin"/libusb-*.dylib "$NATIVE_DIR/"
for library in "$NATIVE_DIR/libtetherkit.0.1.5.dylib" "$NATIVE_DIR/libusb-1.0.0.dylib"; do
    test -f "$library"
    xattr -d com.apple.quarantine "$library" 2>/dev/null || true
done
"$NATIVE_DIR/svorrent-tetherd" --list >/dev/null

echo "==> 1. Building React frontend..."
cd "$ROOT_DIR/frontend"
npm run build

echo "==> 2. Preparing staging directories..."
rm -rf "$APP_BUNDLE" "$DMG_STAGING" "$DMG_OUTPUT"
mkdir -p "$BUILD_DIR"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources/app/backend"
mkdir -p "$APP_BUNDLE/Contents/Resources/app/frontend/dist"
mkdir -p "$DMG_STAGING"

echo "==> 3. Generating macOS AppIcon.icns..."
ICON_TMP="/tmp/svorrent_icon_build"
rm -rf "$ICON_TMP" && mkdir -p "$ICON_TMP/Svorrent.iconset"

qlmanage -t -s 1024 -o "$ICON_TMP" "$ROOT_DIR/frontend/public/favicon.svg" >/dev/null 2>&1
SRC_PNG="$ICON_TMP/favicon.svg.png"

sips -z 16 16     "$SRC_PNG" --out "$ICON_TMP/Svorrent.iconset/icon_16x16.png" >/dev/null
sips -z 32 32     "$SRC_PNG" --out "$ICON_TMP/Svorrent.iconset/icon_16x16@2x.png" >/dev/null
sips -z 32 32     "$SRC_PNG" --out "$ICON_TMP/Svorrent.iconset/icon_32x32.png" >/dev/null
sips -z 64 64     "$SRC_PNG" --out "$ICON_TMP/Svorrent.iconset/icon_32x32@2x.png" >/dev/null
sips -z 128 128   "$SRC_PNG" --out "$ICON_TMP/Svorrent.iconset/icon_128x128.png" >/dev/null
sips -z 256 256   "$SRC_PNG" --out "$ICON_TMP/Svorrent.iconset/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$SRC_PNG" --out "$ICON_TMP/Svorrent.iconset/icon_256x256.png" >/dev/null
sips -z 512 512   "$SRC_PNG" --out "$ICON_TMP/Svorrent.iconset/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$SRC_PNG" --out "$ICON_TMP/Svorrent.iconset/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$SRC_PNG" --out "$ICON_TMP/Svorrent.iconset/icon_512x512@2x.png" >/dev/null

iconutil -c icns "$ICON_TMP/Svorrent.iconset" -o "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
rm -rf "$ICON_TMP"

echo "==> 4. Writing Info.plist..."
cat << 'EOF' > "$APP_BUNDLE/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Svorrent</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.sovopr.svorrent</string>
    <key>CFBundleName</key>
    <string>Svorrent</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.1</string>
    <key>CFBundleVersion</key>
    <string>1.0.1</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

echo "==> 5. Writing Launcher Executable..."
cat << 'EOF' > "$APP_BUNDLE/Contents/MacOS/Svorrent"
#!/usr/bin/env bash
set -e

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RESOURCES_DIR="$APP_DIR/Contents/Resources"
BACKEND_DIR="$RESOURCES_DIR/app/backend"
LOG_DIR="$HOME/Library/Logs/Svorrent"
JOB_LABEL="com.sovopr.svorrent.backend"
AGENT_DIR="$HOME/Library/LaunchAgents"
AGENT_PLIST="$AGENT_DIR/$JOB_LABEL.plist"
JOB_TARGET="gui/$(id -u)/$JOB_LABEL"
mkdir -p "$LOG_DIR"

# A process started from the mounted installer loses its backend when the DMG
# is ejected. Launch only the copy installed in Applications.
if [[ "$APP_DIR" == /Volumes/* || "$APP_DIR" == */AppTranslocation/* ]]; then
    osascript -e 'display alert "Install Svorrent first" message "Drag Svorrent.app to Applications, then open the copy in Applications."'
    exit 1
fi

if [ ! -f "$RESOURCES_DIR/app/frontend/dist/index.html" ]; then
    osascript -e 'display alert "Svorrent installation is incomplete" message "The web app is missing. Copy Svorrent.app to Applications again from a complete installer."'
    exit 1
fi

# A one-time administrator approval installs the bundled TetherKit-based helper.
# The helper watches for Android USB tethering and creates a DHCP-configured
# feth interface without changing the Mac's existing default route.
TETHER_HELPER="/Library/PrivilegedHelperTools/com.svorrent.tetherd/svorrent-tetherd"
TETHER_INSTALLER="$BACKEND_DIR/scripts/install-tetherd.sh"
MACOS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
if [[ "$MACOS_MAJOR" =~ ^[0-9]+$ ]] && [ "$MACOS_MAJOR" -ge 12 ] && \
   [ -x "$BACKEND_DIR/bin/svorrent-tetherd" ] && \
   { [ ! -x "$TETHER_HELPER" ] || ! launchctl print system/com.svorrent.tetherd >/dev/null 2>&1; }; then
    choice="$(osascript -e 'button returned of (display dialog "Enable Android USB tethering for Svorrent? This installs the bundled TetherKit-based network helper and requires one administrator approval. You can do this later by reopening Svorrent." buttons {"Later", "Enable"} default button "Enable" with icon note)' 2>/dev/null)" || choice=""
    if [ "$choice" = "Enable" ]; then
        if ! osascript - "$TETHER_INSTALLER" <<'APPLESCRIPT'
on run argv
    set installerPath to item 1 of argv
    do shell script ("/bin/bash " & quoted form of installerPath) with administrator privileges
end run
APPLESCRIPT
        then
            osascript -e 'display alert "Android tethering setup failed" message "Svorrent can still run. Reopen it to retry Android USB setup."' || true
        fi
    fi
fi

# 1. If Svorrent backend is already running, immediately open default browser
backend_ready() {
    local config torrents
    config="$(curl -fsS --max-time 2 http://127.0.0.1:3001/api/config 2>/dev/null)" || return 1
    [[ "$config" == \{\"downloadDir\":* ]] || return 1
    torrents="$(curl -fsS --max-time 5 http://127.0.0.1:3001/api/torrents 2>/dev/null)" || return 1
    [[ "$torrents" == \[*\] ]]
}

backend_owned_by_this_app() {
    [ -f "$AGENT_PLIST" ] || return 1
    local server_path
    server_path="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:2' "$AGENT_PLIST" 2>/dev/null)" || return 1
    [ "$server_path" = "$BACKEND_DIR/server.js" ] || return 1
    local job_status
    job_status="$(launchctl print "$JOB_TARGET" 2>/dev/null)" || return 1
    [[ "$job_status" == *"state = running"* ]]
}

if backend_ready && backend_owned_by_this_app; then
    open "http://localhost:3001"
    exit 0
fi

# 2. Locate Node runtime (bundled or system)
NODE_BIN=""
if [ -x "$RESOURCES_DIR/node" ]; then
    NODE_BIN="$RESOURCES_DIR/node"
elif command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
elif [ -x "/opt/homebrew/bin/node" ]; then
    NODE_BIN="/opt/homebrew/bin/node"
elif [ -x "/usr/local/bin/node" ]; then
    NODE_BIN="/usr/local/bin/node"
fi

if [ -z "$NODE_BIN" ]; then
    osascript -e 'display alert "Node.js Not Found" message "Svorrent requires Node.js to run. Please install Node.js from https://nodejs.org or via Homebrew."'
    open "https://nodejs.org"
    exit 1
fi

# 3. Run the backend in the user's launchd domain so it survives this launcher.
mkdir -p "$AGENT_DIR"

xml_escape() {
    local value="$1"
    value="${value//&/\&amp;}"
    value="${value//</\&lt;}"
    value="${value//>/\&gt;}"
    value="${value//\"/\&quot;}"
    printf '%s' "$value"
}

cat > "$AGENT_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$JOB_LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$(xml_escape "$NODE_BIN")</string>
    <string>--openssl-legacy-provider</string>
    <string>$(xml_escape "$BACKEND_DIR/server.js")</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$BACKEND_DIR")</string>
  <key>StandardOutPath</key><string>$(xml_escape "$LOG_DIR/svorrent.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$LOG_DIR/svorrent.log")</string>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST

launchctl bootout "$JOB_TARGET" >/dev/null 2>&1 || true
launchctl remove "$JOB_LABEL" >/dev/null 2>&1 || true
: > "$LOG_DIR/svorrent.log"
if ! launchctl bootstrap "gui/$(id -u)" "$AGENT_PLIST"; then
    osascript -e 'display alert "Svorrent could not start" message "The local server could not be registered. Check ~/Library/Logs/Svorrent/svorrent.log, then try again."'
    exit 1
fi

# 4. Wait for server readiness
for i in {1..60}; do
    if backend_ready && backend_owned_by_this_app; then
        break
    fi
    sleep 0.3
done

# 5. Open in user's default browser
if ! backend_ready || ! backend_owned_by_this_app; then
    osascript -e 'display alert "Svorrent could not start" message "The local server did not become ready. Check ~/Library/Logs/Svorrent/svorrent.log, then try again."'
    exit 1
fi
open "http://localhost:3001"
EOF
chmod +x "$APP_BUNDLE/Contents/MacOS/Svorrent"

echo "==> 5.5. Building native tether helper..."
make -C "$ROOT_DIR/backend/tether"

echo "==> 6. Copying application assets..."
cp -R "$ROOT_DIR/frontend/dist"/* "$APP_BUNDLE/Contents/Resources/app/frontend/dist/"
cp -R "$ROOT_DIR/backend/server.js" "$APP_BUNDLE/Contents/Resources/app/backend/"
cp -R "$ROOT_DIR/backend/package.json" "$APP_BUNDLE/Contents/Resources/app/backend/"
cp -R "$ROOT_DIR/backend/lib" "$APP_BUNDLE/Contents/Resources/app/backend/"
cp -R "$ROOT_DIR/backend/bin" "$APP_BUNDLE/Contents/Resources/app/backend/"
cp -f "$NATIVE_DIR/svorrent-tetherd" "$APP_BUNDLE/Contents/Resources/app/backend/bin/"
cp -a "$NATIVE_DIR"/libtetherkit*.dylib "$NATIVE_DIR"/libusb-*.dylib \
    "$APP_BUNDLE/Contents/Resources/app/backend/bin/"
cp -R "$ROOT_DIR/backend/scripts" "$APP_BUNDLE/Contents/Resources/app/backend/"
cp -R "$ROOT_DIR/backend/tether/licenses" "$APP_BUNDLE/Contents/Resources/app/backend/"
cp -R "$ROOT_DIR/backend/node_modules" "$APP_BUNDLE/Contents/Resources/app/backend/"

# Prune heavy unused databases (strip 104MB city-level GeoIP data; keep country data)
echo "==> 7. Pruning heavy offline city databases..."
rm -f "$APP_BUNDLE/Contents/Resources/app/backend/node_modules/geoip-lite/data/geoip-city"*
find "$APP_BUNDLE" -type f \( -name '.DS_Store' -o -name '._*' \) -delete

# Finder metadata copied from a developer checkout can make the app fail to
# copy out of the mounted DMG (Finder error -36). It is not application data.
find "$APP_BUNDLE" -type f \( -name '.DS_Store' -o -name '._*' \) -delete

echo "==> 8. Creating DMG Staging with Applications shortcut..."
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"

echo "==> 9. Generating lightweight compressed DMG installer (BitTorrent Web profile)..."
hdiutil create -volname "Svorrent" -srcfolder "$DMG_STAGING" -ov -fs HFS+ -format UDBZ "$DMG_OUTPUT"

rm -rf "$DMG_STAGING"

echo "==> Svorrent DMG created successfully:"
ls -lh "$DMG_OUTPUT"
