#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
BIN_DIR="${PROJECT_ROOT}/backend/bin"
TOOLS_DIR="/Library/PrivilegedHelperTools"
PLIST_SRC="${SCRIPT_DIR}/com.svorrent.tetherd.plist"
PLIST_DEST="/Library/LaunchDaemons/com.svorrent.tetherd.plist"
LABEL="com.svorrent.tetherd"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[-] Error: Root privileges required. Run with: sudo ./backend/scripts/install-tetherd.sh" >&2
  exit 1
fi

echo "[+] Installing Svorrent Autonomous Tethering Engine..."

# Unload previous service if exists
if launchctl print "system/${LABEL}" >/dev/null 2>&1; then
  echo "[*] Unloading existing ${LABEL} daemon..."
  launchctl bootout "system/${LABEL}" 2>/dev/null || true
fi

# Also unload legacy TetherKit helper if present to prevent USB device claim conflicts
if launchctl print "system/com.tetherkit.helper" >/dev/null 2>&1; then
  echo "[*] Unloading com.tetherkit.helper..."
  launchctl bootout "system/com.tetherkit.helper" 2>/dev/null || true
  pkill -9 com.tetherkit.helper 2>/dev/null || true
fi

# Ensure /Library/PrivilegedHelperTools exists
mkdir -p "${TOOLS_DIR}"

# Copy binary and libraries
echo "[*] Installing svorrent-tetherd to ${TOOLS_DIR}..."
cp -a "${BIN_DIR}/svorrent-tetherd" "${TOOLS_DIR}/svorrent-tetherd"
cp -a "${BIN_DIR}"/libtetherkit*.dylib "${TOOLS_DIR}/"
cp -a "${BIN_DIR}"/libusb-*.dylib "${TOOLS_DIR}/"

chown -R root:wheel "${TOOLS_DIR}/svorrent-tetherd" "${TOOLS_DIR}"/libtetherkit*.dylib "${TOOLS_DIR}"/libusb-*.dylib
chmod 755 "${TOOLS_DIR}/svorrent-tetherd"
find "${TOOLS_DIR}" -maxdepth 1 -name '*.dylib' -type f -exec chmod 444 {} +

# Sign with ad-hoc signature to satisfy Darwin kernel codesign requirements
codesign --force --sign - "${TOOLS_DIR}/svorrent-tetherd" || true
find "${TOOLS_DIR}" -maxdepth 1 -name '*.dylib' -type f -exec codesign --force --sign - {} + || true

# Copy and set up plist
echo "[*] Installing LaunchDaemon to ${PLIST_DEST}..."
cp "${PLIST_SRC}" "${PLIST_DEST}"
chown root:wheel "${PLIST_DEST}"
chmod 644 "${PLIST_DEST}"

# Bootstrap LaunchDaemon
echo "[*] Bootstrapping LaunchDaemon with launchd..."
launchctl bootstrap system "${PLIST_DEST}"

if launchctl print "system/${LABEL}" >/dev/null 2>&1; then
  echo "[+] Success! Svorrent Autonomous Tethering Engine is active and running."
  echo "    Log file: /var/log/svorrent-tetherd.log"
  echo "    Plug in your Samsung or Android phone with USB tethering enabled: it connects automatically!"
else
  echo "[-] Warning: Daemon registered but not yet reporting running state. Check /var/log/svorrent-tetherd.log"
fi
