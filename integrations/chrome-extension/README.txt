FrameUI Capture — local Chrome extension

1. Extract the ZIP. Keep the frameui-chrome-local folder on your computer.
2. Open chrome://extensions, turn on Developer mode and choose Load unpacked.
3. Select the frameui-chrome-local folder. Pin FrameUI Capture in Chrome.
4. Open your website, sign in normally, then click the extension.
5. Name the design and select 1440 px or 1920 px. Click Follow flow.
6. Open the tabs, menus, drawers and dialogs in the order you want. Wait for each screen to save before the next click. Chrome displays its debugger permission banner while recording.
7. Click Done. Choose Export to XD to download the native XD file directly from Chrome. No desktop app or server is required for XD export.

The extension captures states as you visit them, preserving the observed result rather than replaying buttons that could submit or change real data. It does not automatically explore unvisited controls. Do not use browser DevTools while recording; it can disconnect the capture debugger. Browser-native dropdown menus, protected browser pages, closed shadow roots and cross-origin frames may have limitations; review capture notes.

Save capture file downloads a portable FrameUI capture file. Send to FrameUI uses the optional local native messaging bridge described below. No local listening server or external service is used.

All capture data remains in this extension's local storage until cleared. Captures may contain private visible page content; review before sharing. Password input values are redacted by the capture compiler. Removing the extension deletes its local storage.

SEND TO FRAMEUI (macOS)
Use an updated FrameUI build that supports Chrome captures. Open Terminal in this extension folder and run:
  node install-bridge.cjs "/Applications/FrameUI.app"
Replace that path if your updated FrameUI.app is elsewhere. This installs a native messaging host for this extension ID only, plus a private local inbox in ~/Library/Application Support/FrameUI Chrome Bridge. Click Send to FrameUI after Done; FrameUI opens the received design. The app needs to remain installed at the configured location. Run the installer again if you move it.

You can also save the capture file and use Import Chrome capture on a FrameUI project. This adds the design to that project. No bridge is needed for this option.

To remove the bridge, delete ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.frameui.capture.json and ~/Library/Application Support/FrameUI Chrome Bridge. Export any pending captures before removing the inbox.

Capture always uses the chosen 1440 px or 1920 px desktop viewport, independently of the size of your browser window. Your browser zoom is temporarily set to 100% for capture and restored afterward. Native OS menus and unvisited states are not included.
