# FrameUI project workspace, capture and canvas UX rebuild

Spec for Codex. Audit the current implementation first, then update the existing system — do not rebuild unrelated working functionality, and do not introduce generic SaaS dashboard styling.

## Goal

FrameUI should feel like a serious desktop design IDE. Aim for the interaction quality of Figma, VS Code and professional desktop creative software, while keeping FrameUI's own visual language (blue accent, light/dark mode, current project structure, codebase-linked features, component discovery, style discovery, runtime capture, the FrameUI design model).

## Governing hierarchy decision

Stop treating "Capture", "Pages", and "Designs" as three equally important destinations.

- **Designs** are the user's work.
- **Pages, components, styles and assets** are project resources used inside that work.
- **Capture** is a tool for bringing the running product into that work — not a destination of its own.

This hierarchy should drive every navigation and IA decision below and remove most of the current UI clutter.

---

## 1. Remove the old project capture flow

The current project landing screen is wrong. It currently shows messaging similar to "Your project is ready. Capture the running application to create editable designs." with buttons like "Capture application" / "Browse discovered pages". Remove this workflow from the project home screen entirely.

The project has already been connected to its repository and runtime during setup — users should not have to think about "capture application" before doing anything. The project workspace should explain what the project *contains* and let the user immediately work.

The project screen should focus on:

- Project name
- Detected framework
- Connected repository
- Runtime status
- Local application URL
- Number of designs
- Number of discovered pages
- Number of components
- Number of styles/tokens
- Recently edited designs

The primary action should remain **New Design**, but New Design needs a much better flow (see §3).

## 2. Redesign the project home as an IDE project overview

Do not use one enormous empty white card like the current screenshot. The screen should feel like the opening view of a desktop development or design tool.

Suggested structure:

```
Budget
PHP · Runtime connected

Repository   /path/to/budget
Runtime      budget.localhost:4180
```

Then **Recent Designs** — show actual design thumbnails in a compact grid or list. Each design should show:

- Thumbnail
- Name
- Viewport
- Last edited
- Captured or blank design indicator
- Context menu

Then, underneath or alongside, **Project resources** — e.g. "103 Pages · 63 Components · 62 Styles" — acting as entry points into those resources.

For an empty project, show useful guidance instead of a nearly blank page:

```
Start designing
Create a blank screen, capture a screen from your running application,
or start from one of the pages FrameUI discovered in your project.

[New Design]

Browse pages   Browse components   Open application
```

Keep the page visually quiet — this is an IDE project view, not a marketing landing page.

## 3. New Design modal

The current radio-button modal looks unfinished and generic. Replace it.

- Title: **Create a design**
- Supporting copy: "Choose where you want to start. You can always add captured screens, components and assets later."
- **Name** field, placeholder "Untitled design"

Then proper selectable cards (entire card clickable — no oversized exposed radio circles):

1. **Blank canvas** — "Start with an empty frame and build using your project's components, styles and assets."
2. **Capture from application** — "Open your running application, navigate to any state, and turn it into an editable FrameUI design."
3. **Use existing page** — "Start from a page FrameUI already discovered in the repository."

Selected state: subtle tinted background, 1px accent border, small selected indicator.

Footer: **Cancel** / **Create design**. If "Capture from application" is selected, the primary button may read **Open capture** instead.

## 4. One workspace, not separate Capture and Design applications

This is one of the biggest changes. Capture should no longer feel like another section of FrameUI.

Current left navigation: Capture, Designs, Pages, Components, Styles. **Remove Capture as a permanent top-level project section.** Capture is an action inside the design workspace.

New project navigation: **Designs, Pages, Components, Styles, Assets.**

Capture is accessed through New Design → Capture from application, or, while inside a design, through **Capture page**.

Mental model: you are working on designs; capturing is one way of creating content for a design.

## 5. Redesign the main design IDE

Once a design opens, use a proper persistent design-tool layout:

- **Left** — Layers / Assets / Pages
- **Center** — infinite canvas
- **Right** — properties inspector
- **Top** — design toolbar
- **Bottom** — zoom and canvas controls

No oversized page headers, large cards or landing-page spacing inside this workspace. Use compact spacing and consistent control heights:

- Toolbar: ~40–44px
- Inputs: ~30–34px
- Sidebar rows: ~28–32px

Typography: native system UI font stack consistently — macOS `-apple-system, BlinkMacSystemFont`; Windows `Segoe UI`; fallback `Inter, sans-serif`. Do not mix fonts.

## 6. Fix the current empty canvas message

The current "A place for your next screen" card is too large and sits over the canvas like a modal. It should be a lightweight, dismissible helper, e.g.:

```
Start designing
Draw a frame, drag in a component, or capture a screen from your application.

[Draw frame]  [Capture screen]                                    [x]
```

X button top-right. Once dismissed, persist that preference for this design or user. The helper must never block the canvas, and should disappear automatically once meaningful content exists.

## 7. Fix text editing completely

Current behavior creates a huge rectangular text editing layer and visually duplicates/ghosts the text. This is wrong. Text editing needs to behave much closer to Figma.

- **Single click** — select text layer; show normal selection bounds around the actual text object.
- **Double click or Enter** — enter inline text editing. The actual rendered text stays in place.
  - Do not create a white input box.
  - Do not create a second copy of the text.
  - Do not fade the original text.
  - Do not replace the text with a contenteditable element that changes its layout.
  - The caret must appear directly inside the rendered text.
  - Text selection should highlight characters normally.
  - The text box retains its actual dimensions and position.
- **Escape** — exit text editing while keeping the text layer selected.
- **Enter** — respect normal multiline text behaviour.
- **Cmd/Ctrl + Enter** — exit text editing if needed.

The right property panel should update live while text is selected. Typography properties should include values found in the repository: font family, font weight, font size, line height, letter spacing, alignment, colour, opacity. Project token values should appear before arbitrary custom values.

## 8. Moving objects must feel like Figma

Current element manipulation needs a proper interaction engine.

- Click object → selected.
- Click and hold → drag immediately (no separate "move mode" for ordinary objects).
- Release → commit new position.

While dragging, show: alignment guides, distances to nearby objects, frame centre guide, edge snapping, sibling alignment, container padding guides. Snapping should feel magnetic but never aggressive; hold a modifier key to temporarily bypass snapping.

- Multi-selection with Shift; dragging a multi-selection moves all selected layers together.
- Arrow keys: move 1px. Shift + arrow: move 10px.

The canvas should update at interactive frame rates. Avoid React state updates on every pointer movement if that causes latency — use an interaction layer and commit state at appropriate points.

## 9. Grouping and ungrouping

Captured designs currently create grouped structures users cannot meaningfully manipulate. Must change. Support: group selection, ungroup, regroup, enter group, select child, select parent, move child independently, move group, resize group.

Keyboard: Cmd/Ctrl+G group; Shift+Cmd/Ctrl+G ungroup; double click enters group or selects child; Escape moves one level upward.

The Layers panel must clearly show hierarchy, e.g.:

```
Hero section
  Badge
  Heading
  Description
  CTA group
    Start free
    Follow payday
```

Any layer group must be expandable/collapsible. Do not turn an entire captured webpage into one enormous locked group.

## 10. Distinguish structural layers from groups

A real DOM hierarchy is not the same thing as a manually grouped set of design objects. FrameUI should understand distinct layer kinds: Frame, Section, Container, Component, Group, Text, Image, SVG, Shape.

Where the original page uses a layout container, preserve that relationship where useful — but designers must still be able to detach or flatten it. Provide **Ungroup**, and for source-linked structures, **Detach from structure** (converts children into independently editable layers without destroying their visual positions).

## 11. Capture should open inside the design workspace

The capture screen in the current screenshot is far too small — the app is squeezed between toolbars, browser controls and permanent navigation. When capture starts, the canvas area should transform into **Capture Mode**, without navigating the user away from the design workspace. Example layout:

```
FrameUI sidebar
  CAPTURED SCREENS
    Dashboard [thumbnail]
    Settings [thumbnail]
    User modal [thumbnail]
    + New capture
    Collapse
```

The remaining majority of the application window becomes the live browser.

## 12. Collapsible capture sidebar

~220–260px expanded. Shows every screen captured during the current capture session. Each item: thumbnail, screen name, viewport indicator, state name if applicable, e.g.:

```
Dashboard     Desktop · 1440 × 1024
Profile       Mobile · 390 × 844
Edit user     Desktop · Modal open
```

Collapses into a narrow rail with one consistent chevron icon (remove the current strange collapse symbols and miscellaneous bottom icons). Collapsed state preserves: screen count, expand control, capture control.

## 13. Make the live capture view much bigger

Capture mode should prioritize the application. Top capture toolbar: Back, Forward, Reload, URL, Desktop/Tablet/Mobile/Custom, Capture screen. Everything else stays out of the way — the browser viewport consumes almost all remaining space. No large descriptions above it; move descriptive help into a first-use tooltip or small info button.

## 14. Responsive capture

Viewport controls stay visible in the capture toolbar: Desktop 1440×1024, Tablet 768×1024, Mobile 390×844, Custom. The browser must actually change its viewport dimensions (not just scale a desktop render down visually) — the application's own CSS breakpoints must fire. Remember the selected viewport per capture where appropriate.

## 15. Capture current state

Capture must preserve what the user currently sees: current route, scroll position, open dialog, open dropdown, expanded menu, selected tab, loaded data, responsive viewport, application state. Do not treat a URL as the entire page identity — a designer might capture "Users", "Users with search results", "Users with edit modal", "Users permissions tab", "Users empty state", all sharing the same route.

## 16. Better capture progress UI

No generic large modal + spinner. Use a compact, professional progress panel, e.g.:

```
Creating editable screen
Dashboard · Desktop · 1440 × 1024

Reading rendered layout          Complete
Collecting computed styles       Complete
Loading fonts and assets         Complete
Matching repository components   Complete
Building editable layers         72%

[Cancel]
```

On completion:

```
Dashboard captured
42 editable layers · 17 components matched · 12 project styles linked

[Add to design]  [Capture another]
```

If the capture automatically goes into the active design, say: `Added to "Homepage concepts"`.

## 17. After capture, place the screen on the canvas

Don't make the user jump through another screen. Once Capture Mode ends, restore the normal design canvas — every captured screen should already exist as a frame on the canvas (e.g. "Dashboard Desktop", "Dashboard Tablet", "Dashboard Mobile"), spaced intelligently with consistent gaps, never stacked directly over one another. Zoom to fit the newly added frames.

## 18. Capture into an existing design

Inside any design, add **Capture page**. This temporarily switches the central canvas into Capture Mode; the current design remains open. The user navigates the application, captures one or more states, clicks **Done**. The live browser disappears and the captured frames are inserted into the current canvas. This is the workflow FrameUI should use going forward.

## 19. Redesign the top toolbar

Proper tool system. Suggested tools: Select, Frame, Shape, Text, Component, Hand. Separate actions: Capture, Preview, Export. Use one consistent icon library appropriate for the desktop application — do not mix unicode arrows, text characters, random SVG styles, filled icons and outline icons; every icon should use the same visual weight. Tooltips must explain less obvious controls, e.g.:

```
Frame
Create a new screen or container
F
```

## 20. Fix the left sidebar

Behave like a real design tool. Top: Layers / Assets. Layers view has a search field, e.g.:

```
Search layers

Page
  Header
    Logo
    Navigation
  Hero
    Eyebrow
    Heading
    Description
    Buttons
    Dashboard preview
```

Small disclosure chevrons. Hover actions appear only when relevant — no permanently noisy controls. Right-click/context actions: Rename, Duplicate, Group, Ungroup, Hide, Lock, Delete, Copy, Copy styles.

## 21. Right properties inspector

A selected object should always have useful properties.

- **Text layer** — Position, Size, Typography, Fill, Opacity.
- **Container** — Position, Size, Layout, Spacing, Fill, Border, Radius, Shadow, Opacity.
- **Image** — Position, Size, Fit, Crop, Radius, Opacity.
- **Component** — Component, Variant, Properties, Layout, Appearance.

Project values should be clearly identifiable, e.g. `Radius 6px · Project token`, `Spacing 16px · space-4`. This helps designers stay consistent with the original application.

## 22. Fix canvas scaling

A 1520×22108 page compressed into a tiny vertical image is not acceptable. When a very tall page is captured, initially zoom to fit *width*, not the entire page — the user should immediately see the top of the design at a useful editing scale.

Provide: Zoom to selection, Zoom to fit, Zoom to 100%, Zoom in, Zoom out. Trackpad: pinch changes zoom smoothly, two-finger movement pans, Space+drag pans. Cmd/Ctrl+0 fits content, Cmd/Ctrl+1 shows 100%. The zoom anchor should remain under the pointer.

## 23. Better page names

Never default captured work to "Untitled" if enough information exists. Use `document.title`, route, H1, or repository route metadata to suggest a sensible name. E.g. "Budget Homepage" instead of "Untitled"; "User Settings · Edit profile" for another state. Keep names editable.

## 24. Modals need a full visual pass

Audit every modal in FrameUI. The current New Design modal is oversized and visually empty. Create one reusable modal system, sized to content:

- **Small** — confirmation
- **Medium** — forms
- **Large** — complex flows

Do not use a giant dialog for three controls. Every modal should consistently contain: clear title, one sentence explaining what will happen, logical form groups, clear primary action, clear secondary action, close X where appropriate (top-right). Escape must close dismissible dialogs. Clicking the backdrop should only close where it is safe.

## 25. Improve copy throughout FrameUI

Audit labels, helper text, empty states, errors, progress screens and onboarding. A designer should never have to understand FrameUI's implementation terminology to use the product. Examples:

| Avoid | Use |
|---|---|
| "Runtime preview available" | "Application connected" |
| "Browse discovered pages" | "Browse project pages" |
| "Capture application" | "Capture a screen" |
| "Current state" | The actual detected state, or "Name this state" |

For the state-name field: `State name (Optional) — Describe what is currently open, for example "Edit user modal".`

## 26. Use contextual guidance, not permanent explanations

FrameUI currently risks filling every screen with instructional copy — don't. First-use guidance can appear as a dismissible helper, tooltip, empty state, or small info popover. Once the user understands the area, get out of their way. The workspace should become denser as content exists.

## 27. Visual quality

Avoid: huge empty white cards, excessive borders, oversized controls, massive font sizes, randomly rounded surfaces, marketing-style gradients, decorative illustrations, generic SaaS dashboard sections, multiple icon styles.

Use: subtle separation, compact controls, clear hierarchy, consistent corner radius, precise 1px borders, proper hover/focus/pressed states, native-feeling typography, careful alignment, consistent spacing rhythm.

FrameUI should feel like professional desktop software — not a website placed inside Electron.

## 28. Keep FrameUI's existing visual identity

Do not clone Figma's visual design — copy interaction quality and familiar design-tool behaviour. Retain FrameUI's blue accent, light/dark mode, current project structure, codebase-linked features, component discovery, style discovery, runtime capture, and the FrameUI design model.

## 29. Required user journey after this change

A normal user should be able to do this without thinking about FrameUI's internal architecture:

Open FrameUI → open "Budget" → see recent designs and project information → click New Design → choose Capture from application → live Budget application fills the workspace → navigate to homepage → select Desktop → Capture → navigate to login → Capture → log in → open dashboard → Capture → switch to Mobile → Capture → click Done → return to canvas → see four properly named editable frames → double-click heading → edit text directly in place → click a card → drag it somewhere else → shift-click another item → move both → select a group → ungroup it → select an individual child → change its spacing → open Assets → drag an existing project component onto the canvas → Save.

At no stage should the user have to understand DOM capture, repository scanning, SVG conversion or internal route-discovery terminology.

## 30. Do a complete audit while implementing this

Do not only change the screens shown in the screenshots. Inspect the existing FrameUI code and identify every place affected by this new model. Pay particular attention to: project navigation, New Design, Capture, Canvas, Text editing, Pointer interactions, Grouping, Layer hierarchy, Zoom/pan, Keyboard shortcuts, Properties inspector, Modals, Empty states, Tooltips, Notifications, Icon consistency, Typography, Spacing, Focus states, Dark mode, Light mode.

Reuse the underlying working functionality wherever practical. Remove obsolete flows instead of leaving old and new workflows available at the same time.

## 31. Acceptance standard

Do not consider this task finished because the UI looks better. It is complete when:

- The project home feels like an IDE.
- Capture is no longer a permanent project section.
- Capture happens inside a design workflow.
- The live application receives most of the capture workspace.
- Captured screens appear in a collapsible session sidebar.
- Done returns captured screens directly to the canvas.
- Text editing happens directly on the rendered text.
- Text no longer duplicates or ghosts.
- Objects can be click-dragged naturally.
- Groups can be entered and ungrouped.
- Captured DOM structure does not permanently trap elements.
- Very tall pages open at a useful editing zoom.
- The canvas supports professional pan and zoom behaviour.
- New Design clearly explains all starting options.
- The temporary canvas helper has an X and can be dismissed.
- Modals use one consistent visual system.
- Iconography is consistent.
- Copy throughout the application tells designers what an action does.
- Old capture-flow UI has been removed.
- Nothing feels like a generic web admin dashboard.
