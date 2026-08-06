# Claude Code Memory

A Claude Code plugin that turns your own session history into a persistent, queryable
knowledge graph — a second brain across every repo you work in — visualized natively
in Obsidian.

## The problem this solves

If you work across multiple repos from Claude Code, every fresh session starts from
zero: you re-explain architecture, re-state conventions, and re-grant permissions you
already gave last week. This plugin captures that once and makes it available
automatically going forward.

## How it works

- **A vault** — a plain folder of markdown notes (default `~/ClaudeMemory-vault`),
  wikilinked by entity (`Project`, `Convention`, `Decision`, `Permission`,
  `Preference`, `Session`, and domain-specific notes like `Schema`). Open it as an
  Obsidian vault and the built-in Graph view renders it, no extra plugins needed.
- **An MCP server** (`mcp-server/`) — runs automatically once this plugin is enabled,
  giving Claude tools to read from and write to the vault:
  - `get_project_context(repo_path)` — Claude calls this before starting work in a
    repo, pulling in everything remembered about it (architecture, conventions,
    decisions, permissions, schema) without you re-explaining anything.
  - `search_memory`, `get_entity`, `list_related` — deeper on-demand queries.
  - `remember(...)` — Claude calls this live, mid-conversation, whenever you tell it
    something worth keeping.
- **A `sync-memory` skill** — invoked manually as `/sync-memory <days>`, it reads your
  actual Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) for the given day
  window and extracts them into the vault. Small deltas are processed serially; a
  large backfill (first run, or a long gap) fans out across subagents — one per
  project/date-range batch, each purely extracting and reporting back — with a single
  reconciliation pass doing all the actual writing, so parallel extraction never races
  on the same file.

## Setup

1. Enable this plugin in Claude Code (adds the `memory` MCP server and the
   `sync-memory` skill).
2. Optionally set `CLAUDE_MEMORY_VAULT_DIR` if you don't want the default
   `~/ClaudeMemory-vault` location.
3. Run `/sync-memory 30` (or however far back you want) to do a first import.
4. Open the vault folder in Obsidian and look at Graph view.

From then on, `get_project_context` and `remember` work automatically in every
session; run `/sync-memory <days>` again whenever you want to pull in more history.

## Repo layout

```
.claude-plugin/plugin.json   plugin manifest
.mcp.json                    registers the memory MCP server
mcp-server/                  Node stdio MCP server (read + write tools over the vault)
skills/sync-memory/          the /sync-memory <days> skill and its recon/state scripts
vault-template/              seeds a new vault: Obsidian graph color config + a starter note
```
