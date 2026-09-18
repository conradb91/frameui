# FrameUI local environment engine

The `stacker/lib` modules are vendored from the sibling Stacker application (0.1.2). `stacker/engine.cjs` adapts its orchestration without starting its Electron app, registering its IPC surface, importing its project list, or loading its UI.

FrameUI owns storage under its user-data `LocalEnvironment` directory and credentials under `com.frameui.hosting`. Local routing uses port 4181 to coexist with standalone Stacker. Only the typed FrameUI hosting bridge can invoke the internal engine. Database engines and managed runtimes are shared within FrameUI; project settings and database identities remain scoped to the imported folder.

Do not replace the engine with Stacker's main entry: it owns a separate lifecycle and global IPC handlers. Keep upstream changes explicit and run hosting smoke tests after updates.
