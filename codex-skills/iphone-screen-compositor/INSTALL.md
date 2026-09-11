# Install on another computer

This package is portable across Windows, macOS, and Linux. It includes the locked iPhone reference, masks, calibration, compositor, and dependency manifest. Images are processed locally.

## Requirements

- Codex or Claude Code
- Node.js 20.11 or newer with npm

## Install

1. Extract the ZIP. Keep the contained folder named `iphone-screen-compositor`.
2. Copy that folder into the personal skills directory of your agent:
   - Codex, Windows: `%USERPROFILE%\.codex\skills\iphone-screen-compositor`
   - Codex, macOS or Linux: `~/.codex/skills/iphone-screen-compositor`
   - Claude Code, Windows: `%USERPROFILE%\.claude\skills\iphone-screen-compositor`
   - Claude Code, macOS or Linux: `~/.claude/skills/iphone-screen-compositor`
3. In a terminal, change into that copied folder and install the locked runtime dependency:

```bash
npm ci --omit=dev
```

4. Confirm the runtime. This loads sharp, verifies every locked asset against `calibration.json`, and renders reference chrome plus adaptive dark, light, light-grey, teal, and orange headers in memory; it ends with `self-test passed`:

```bash
npm run check
```

5. Start a new session. In Codex invoke `$iphone-screen-compositor`; in Claude Code invoke `/iphone-screen-compositor`. Or just ask the agent to put a folder of clean UI screenshots into the locked iPhone reference.

The one-time `npm ci` step downloads the correct `sharp` build for that computer. Normal image processing is then local and does not require the original `image-tools` project.
