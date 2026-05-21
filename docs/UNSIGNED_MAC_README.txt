USMCC Publicity Helper (Unsigned Build)
======================================

If macOS blocks the app or it appears to close immediately, remove quarantine from the installed app:

  xattr -dr com.apple.quarantine "/Applications/USMCC Publicity Helper.app"

Then launch the app again.

Notes:
- This build is unsigned (no Apple Developer notarization).
- You only need to run the command once per installed app bundle.
