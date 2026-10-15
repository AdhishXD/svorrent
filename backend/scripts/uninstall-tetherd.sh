#!/usr/bin/env bash
set -euo pipefail

LABEL="com.svorrent.tetherd"
PLIST_DEST="/Library/LaunchDaemons/${LABEL}.plist"
TOOL_PATH="/Library/PrivilegedHelperTools/svorrent-tetherd"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[-] Error: Root privileges required. Run with: sudo ./backend/scripts/uninstall-tetherd.sh" >&2
  exit 1
fi

echo "[*] Unloading ${LABEL} daemon..."
launchctl bootout "system/${LABEL}" 2>/dev/null || true

echo "[*] Removing daemon files..."
rm -f "${PLIST_DEST}"
rm -f "${TOOL_PATH}"

echo "[+] Uninstalled Svorrent Autonomous Tethering Engine."
