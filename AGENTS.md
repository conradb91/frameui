# Local workflow preferences

- Keep work local. Do not commit, push, publish, or trigger GitHub workflows unless the user explicitly changes this instruction.
- Keep `release/` clean: retain only the latest successfully verified release and its associated app bundle and packaging files. After verifying a replacement, remove older release artifacts and build directories. Preserve the currently verified release until its replacement passes checks.
- Each new review DMG must start with a fresh FrameUI profile, without old projects, settings, or runtime data. Preserve source projects and user databases; use the existing build-specific review-profile mechanism.
