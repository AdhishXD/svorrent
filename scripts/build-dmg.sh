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

echo "==> 1. Building React frontend..."
cd "$ROOT_DIR/frontend"
npm run build

echo "==> 2. Preparing staging directories..."
rm -rf "$BUILD_DIR"
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
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
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
mkdir -p "$LOG_DIR"

# 1. If Svorrent backend is already running, immediately open default browser
if curl -s -m 1 http://localhost:3001/api/torrents >/dev/null 2>&1; then
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

# 3. Launch Svorrent daemon in background
cd "$BACKEND_DIR"
nohup "$NODE_BIN" --openssl-legacy-provider server.js > "$LOG_DIR/svorrent.log" 2>&1 &

# 4. Wait for server readiness
for i in {1..20}; do
    if curl -s -m 1 http://localhost:3001/api/torrents >/dev/null 2>&1; then
        break
    fi
    sleep 0.3
done

# 5. Open in user's default browser
open "http://localhost:3001"
EOF
chmod +x "$APP_BUNDLE/Contents/MacOS/Svorrent"

echo "==> 6. Copying application assets..."
cp -R "$ROOT_DIR/frontend/dist"/* "$APP_BUNDLE/Contents/Resources/app/frontend/dist/"
cp -R "$ROOT_DIR/backend/server.js" "$APP_BUNDLE/Contents/Resources/app/backend/"
cp -R "$ROOT_DIR/backend/package.json" "$APP_BUNDLE/Contents/Resources/app/backend/"
cp -R "$ROOT_DIR/backend/lib" "$APP_BUNDLE/Contents/Resources/app/backend/"
cp -R "$ROOT_DIR/backend/bin" "$APP_BUNDLE/Contents/Resources/app/backend/"
cp -R "$ROOT_DIR/backend/node_modules" "$APP_BUNDLE/Contents/Resources/app/backend/"

# Prune heavy unused databases (strip 104MB city-level GeoIP data; keep country data)
echo "==> 7. Pruning heavy offline city databases..."
rm -f "$APP_BUNDLE/Contents/Resources/app/backend/node_modules/geoip-lite/data/geoip-city"*

echo "==> 8. Creating DMG Staging with Applications shortcut..."
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"

echo "==> 9. Generating lightweight compressed DMG installer (BitTorrent Web profile)..."
hdiutil create -volname "Svorrent" -srcfolder "$DMG_STAGING" -ov -fs HFS+ -format UDBZ "$DMG_OUTPUT"

rm -rf "$DMG_STAGING"

echo "==> Svorrent DMG created successfully:"
ls -lh "$DMG_OUTPUT"
