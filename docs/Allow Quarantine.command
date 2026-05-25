#!/bin/bash
# Removes the macOS quarantine attribute from USMCC Publicity Helper.app so an
# unsigned build will launch without Gatekeeper blocking it.
#
# Why this is needed:
#   This app is ad-hoc signed (no Apple Developer Program account), so macOS
#   flags it as "from an unidentified developer" and blocks launch until the
#   quarantine attribute is removed. This script removes that attribute for
#   the installed copy of the app.
#
# How to use:
#   1. Drag "USMCC Publicity Helper.app" into the Applications shortcut in
#      this DMG.
#   2. Double-click this script (Allow Quarantine.command).
#   3. macOS will open Terminal, run this script, and the app will launch
#      normally afterwards.

set -e

APP_PATH="/Applications/USMCC Publicity Helper.app"

echo
echo "USMCC Publicity Helper — quarantine removal"
echo "==========================================="
echo

if [ ! -d "$APP_PATH" ]; then
  echo "Cannot find the app at:"
  echo "  $APP_PATH"
  echo
  echo "Make sure you dragged \"USMCC Publicity Helper.app\" from this DMG"
  echo "into the Applications folder shortcut first, then re-run this script."
  echo
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo "Removing quarantine flag from:"
echo "  $APP_PATH"
echo

if xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null; then
  echo "Done. You can now launch USMCC Publicity Helper from Applications,"
  echo "Spotlight, or Launchpad."
else
  echo "Quarantine flag was already absent (or could not be removed). The app"
  echo "should launch normally."
fi

echo
read -n 1 -s -r -p "Press any key to close this window..."
