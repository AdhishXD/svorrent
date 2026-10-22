#!/usr/bin/env bash
set -euo pipefail

LABEL="com.svorrent.tetherd"
PLIST_DEST="/Library/LaunchDaemons/${LABEL}.plist"
TOOL_DIR="/Library/PrivilegedHelperTools/com.svorrent.tetherd"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[-] Error: Root privileges required. Run with: sudo ./backend/scripts/uninstall-tetherd.sh" >&2
  exit 1
fi

echo "[*] Unloading ${LABEL} daemon..."
launchctl bootout "system/${LABEL}" 2>/dev/null || true

echo "[*] Removing daemon files..."
rm -f "${PLIST_DEST}"
rm -rf "${TOOL_DIR}"
rm -f /Library/PrivilegedHelperTools/svorrent-tetherd
rm -f /Library/PrivilegedHelperTools/libtetherkit*.dylib
rm -f /Library/PrivilegedHelperTools/libusb-*.dylib

echo "[*] Cleaning up virtual network interfaces..."
for iface in $(ifconfig -l 2>/dev/null || true); do
  if [[ "${iface}" =~ ^feth ]]; then
    echo "    Tearing down ${iface}..."
    ifconfig "${iface}" destroy 2>/dev/null || true
  fi
done

echo "[+] Uninstalled Svorrent Autonomous Tethering Engine."
