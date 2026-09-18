# FrameUI Importer for Figma

This local Figma plugin reconstructs a `.frameui` export as native Figma pages, frames, Auto Layout, editable text, range-formatted text, vectors, images, components, instances, effects, and variables. Stable FrameUI IDs are written with Figma plugin metadata.

For local review, in the Figma desktop app choose **Plugins → Development → Import plugin from manifest…** and select `manifest.json` in this folder. No network access or FrameUI/Figma credentials are required.

The manifest uses a local development ID. Publishing to the Figma Community requires assigning the plugin ID issued by Figma; this repository intentionally does not publish or authenticate on the user's behalf.
