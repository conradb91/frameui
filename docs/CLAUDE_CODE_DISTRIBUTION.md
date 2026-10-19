# Claude Code installation in FrameUI

Checked against Anthropic's documentation on 16 October 2026:

- https://code.claude.com/docs/en/legal-and-compliance
- https://code.claude.com/docs/en/setup

FrameUI does not bundle, download or install Claude Code. Users install the official CLI separately. FrameUI detects that installation and invokes its unmodified `auth login` command for Anthropic’s own browser authentication. It can also connect using an existing Claude Code login. No Claude credentials or OAuth tokens are read by FrameUI. Users supply their own accounts and pay Anthropic directly.

Anthropic states that offering or running Claude Code in a product requires agreement to its Commercial Terms unless otherwise agreed. FrameUI's distributor must satisfy that condition before distribution; this implementation does not accept that agreement on the distributor's behalf. The documentation permits an end user to authenticate to the unmodified binary with their own subscription, while prohibiting a third-party application from collecting/intermediating subscription credentials or routing requests itself using those credentials. API-key authentication remains available.

The setup guide opens in the browser; FrameUI cannot execute an installer. Anthropic's own authentication, update and usage policies continue to apply. Plain-text references describe the integration and do not imply endorsement. This note records the implementation and published requirements, not a legal opinion.
