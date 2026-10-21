#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
BIN_DIR="${PROJECT_ROOT}/backend/bin"
TOOLS_DIR="/Library/PrivilegedHelperTools/com.svorrent.tetherd"
PLIST_SRC="${SCRIPT_DIR}/com.svorrent.tetherd.plist"
PLIST_DEST="/Library/LaunchDaemons/com.svorrent.tetherd.plist"
LABEL="com.svorrent.tetherd"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[-] Error: Root privileges required. Run with: sudo ./backend/scripts/install-tetherd.sh" >&2
  exit 1
fi

echo "[+] Installing Svorrent Autonomous Tethering Engine..."

if [[ ! -x "${BIN_DIR}/svorrent-tetherd" || ! -f "${BIN_DIR}/libtetherkit.0.1.5.dylib" || ! -f "${BIN_DIR}/libusb-1.0.0.dylib" ]]; then
  echo "[-] The Android tethering component is missing from this app." >&2
  exit 1
fi

# Unload previous service if exists
if launchctl print "system/${LABEL}" >/dev/null 2>&1; then
  echo "[*] Unloading existing ${LABEL} daemon..."
  launchctl bootout "system/${LABEL}" 2>/dev/null || true
fi

# Keep bundled libraries private to Svorrent.
install -d -m 755 "${TOOLS_DIR}"

# Copy binary and libraries
echo "[*] Installing svorrent-tetherd to ${TOOLS_DIR}..."
cp -a "${BIN_DIR}/svorrent-tetherd" "${TOOLS_DIR}/svorrent-tetherd"
cp -a "${BIN_DIR}"/libtetherkit*.dylib "${TOOLS_DIR}/"
cp -a "${BIN_DIR}"/libusb-*.dylib "${TOOLS_DIR}/"

chown -R root:wheel "${TOOLS_DIR}"
chmod 755 "${TOOLS_DIR}/svorrent-tetherd"
find "${TOOLS_DIR}" -maxdepth 1 -name '*.dylib' -type f -exec chmod 644 {} +

# The build signs the helper; preserve and verify those signatures on install.
codesign --verify "${TOOLS_DIR}/svorrent-tetherd"
find "${TOOLS_DIR}" -maxdepth 1 -name '*.dylib' -type f -exec codesign --verify {} +

# Copy and set up plist
echo "[*] Installing LaunchDaemon to ${PLIST_DEST}..."
cp "${PLIST_SRC}" "${PLIST_DEST}"
chown root:wheel "${PLIST_DEST}"
chmod 644 "${PLIST_DEST}"

# A downloaded DMG marks copied files as quarantined. launchd refuses a
# quarantined LaunchDaemon plist (error 155), even after administrator approval.
# Clear that attribute only from Svorrent's installed, verified helper files.
for installed_file in "${TOOLS_DIR}/svorrent-tetherd" \
  "${TOOLS_DIR}/libtetherkit.0.1.5.dylib" \
  "${TOOLS_DIR}/libusb-1.0.0.dylib" "${PLIST_DEST}"; do
  xattr -d com.apple.quarantine "${installed_file}" 2>/dev/null || true
  if xattr -p com.apple.quarantine "${installed_file}" >/dev/null 2>&1; then
    echo "[-] Could not remove quarantine from ${installed_file}" >&2
    exit 1
  fi
done
for installed_link in "${TOOLS_DIR}/libtetherkit.0.dylib" \
  "${TOOLS_DIR}/libtetherkit.dylib"; do
  xattr -ds com.apple.quarantine "${installed_link}" 2>/dev/null || true
  if xattr -ps com.apple.quarantine "${installed_link}" >/dev/null 2>&1; then
    echo "[-] Could not remove quarantine from ${installed_link}" >&2
    exit 1
  fi
done

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
