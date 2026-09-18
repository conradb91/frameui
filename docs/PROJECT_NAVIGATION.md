# Project navigation update

FrameUI retains its existing theme and canvas styling. Opened projects now land on Design Files, with permanent navigation for Pages, Components, Design Tokens & Styles, Assets and Archive / Trash. The overview shows design files, recently viewed pages, resource counts and capture activity.

Pages use actual captured thumbnails, route/state grouping, All/Desktop/Tablet/Mobile filtering, name/recent sorting, route search, grid/list views and collapsible groups. Viewport selection is remembered for the project during the session. Cards display at most 40 items initially. Hover previews appear after 350 ms, show dimensions and capture time, and switch captured variants. Unknown thumbnails are explicitly marked unavailable. Original pages open only when a concrete URL can be resolved; parameterized routes need a concrete address.

Inside a design file, the project navigation remains visible beside the existing collapsible resource panel. Pages, Components, Layers and Assets modes provide focused browsing. Pages can be dragged, double-clicked or added with +; previews alone do not insert content. Design file pages remain accessible from Layers. Tokens open the existing variable editor within the design file.

Project resources can be copied into a new or existing design file through a destination dialog. Only required component masters are copied. Archive / Trash provides reversible local archiving of design files, not permanent deletion. Source files are never moved or deleted. Image/icon discovery is deferred until Assets is opened.

Validation includes grouping/state unit tests and an Electron workflow covering capture, search, viewport filtering, preview, editable insertion, dragging, component states, offline reopening, archive/restore and adding to an existing file. Review DMG: release/navigation-review/FrameUI-0.1.0.dmg, with a fresh build-specific review profile.
