---
type: note
tags: [meta]
created: 2026-01-01
updated: 2026-01-01
source: sync
---

# Claude Code Memory

This vault is Claude Code's persistent memory: architecture, conventions, decisions,
standing permissions, and preferences pulled from your Claude Code session history,
plus anything Claude decided to remember live while working with you.

It's populated two ways:
- **Bulk**: running `/sync-memory <days>` inside Claude Code.
- **Live**: Claude calling its `remember` tool mid-session when you tell it something worth keeping.

## How to read the graph

Open the **Graph view** (core plugin, already enabled) to see everything at once, color-coded by type:

- **Project** — one per repo, the anchor node everything else links from
- **Convention** — coding style / process rules
- **Decision** — "we chose X over Y because Z"
- **Permission** — standing approvals, so Claude stops asking
- **Preference** — your personal working style
- **Session** — a dated log entry from a Claude Code session
- **Schema / other domain notes** — anything project-specific worth remembering (DB schema, API contracts, etc.)

Click any node to open the note; the backlinks pane shows what points to it.

## Nothing here yet?

Run `/sync-memory 30` inside Claude Code (in a repo you've used it in before) to do a first import.
