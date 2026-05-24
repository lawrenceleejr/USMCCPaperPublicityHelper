USMCC Publicity Helper — install instructions
==============================================

This build is ad-hoc signed (no Apple Developer ID / notarization), so macOS
flags it as quarantined on first launch. There are exactly two steps to
install:

  1. Drag "USMCC Publicity Helper.app" onto the "Applications" shortcut in
     this DMG window.

  2. Double-click "Allow Quarantine.command" (also in this DMG). It opens
     a Terminal window, removes the quarantine flag from the copy you just
     installed, and tells you when it's done. You only need to run this
     script once per installed copy.

After that you can launch the app normally from Applications, Spotlight,
or Launchpad. If you ever reinstall or update the app, just re-run the
script.

Why this is needed
------------------
Without the Apple Developer Program, the app can only be ad-hoc signed.
macOS quarantines binaries from unidentified developers until the
attribute is cleared. The script runs:

  xattr -dr com.apple.quarantine "/Applications/USMCC Publicity Helper.app"

which is the same command you'd type in Terminal yourself.

Troubleshooting
---------------
- "Allow Quarantine.command" can't run: right-click it, choose Open, then
  confirm "Open" in the prompt. macOS may quarantine the script itself
  on first run.
- "Cannot find the app": you didn't drag it to Applications first.
  Drag it, then re-run the script.
