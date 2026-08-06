---
name: sync-memory
description: Bulk-extracts Claude Code session history into the memory vault as a knowledge graph. User-invoked only via /sync-memory <days> — never trigger this yourself based on conversation content.
disable-model-invocation: true
---

# sync-memory

Invoked as `/sync-memory <days>`. `$ARGUMENTS` holds what the user typed after the command name — parse the leading number as the day window, defaulting to `7` if empty or not a number.

Goal: turn recent Claude Code transcripts into vault notes (Project, Convention, Decision, Permission, Preference, Session, and domain-specific entities like Schema), reusing existing notes instead of duplicating them, and record cross-project links for anything shared between repos.

Every mutation to the vault MUST go through the `remember` / `remember_batch` MCP tools (the `memory` server bundled with this plugin) — never write vault markdown files directly with Write/Edit. Those tools own the dedup/merge logic; bypassing them is how the graph fragments into duplicate nodes.

## Phase 0 — Recon (cheap, deterministic)

Run:
```
node "${CLAUDE_PLUGIN_ROOT}/skills/sync-memory/scripts/recon.js" <days>
```
This is filesystem stats only — no transcript content is read. It returns, per project directory under `~/.claude/projects/`, how many bytes of session content are new since the last successful sync (tracked in the vault's `.claude-memory-sync-state.json`).

If `totals.newSessionCount` is `0`, tell the user there's nothing new to sync and stop.

## Decide: serial or fan-out

- **Small volume** (rough guide: fewer than ~5 projects have new sessions, or total new bytes is small, say under a few hundred KB) → skip straight to **Serial path** below.
- **Large volume** (a true first run, or a long gap since the last sync) → use **Fan-out path** below.

Use judgment on the exact cutoff — the point is to avoid spinning up parallel subagents for a two-session catch-up, and to avoid trying to process a huge first-time backfill in one context window.

## Serial path (small deltas)

For each project with new sessions:
1. Read the new portion of its transcript file(s) (the ones listed in `newSessionFiles`). Since the JSONL schema is internal and can vary by version, inspect one sample line first (`head -n 1 <file>`) to see the current field shapes before parsing — look for a `cwd`-like field to get the *real* repo path (do not derive it from the recon-reported `encodedDirName`, which is lossy).
2. Extract durable facts: architecture summary → `project` entity (set `repo_path`), conventions, decisions, permissions granted, preferences expressed, notable schema/domain facts, and a short `session` summary entity linking back to the project.
3. Before creating a new entity, check whether it already exists (`search_memory` / `get_entity`) so you reuse the same title rather than creating a near-duplicate.
4. Call `remember` (or `remember_batch` for the whole project's batch) to persist everything.
5. Once persisted, run:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/sync-memory/scripts/mark_synced.js" <projectDir>
   ```
   to advance that project's sync-state marker. Only mark a project synced after its facts are actually written.

## Fan-out path (large volume)

**Phase 1 — Plan.** Look at the recon volume table and bin-pack the work into batches — group small projects together, split a single huge project's `newSessionFiles` by date range if needed. Aim for roughly even-sized batches, capped at ~4-5 concurrent subagents at a time (run in more than one wave if there are more batches than that).

**Phase 2 — Extract (subagents).** For each batch, launch an Agent with instructions to: read that batch's transcripts (same field-discovery caveat as the serial path — inspect a sample line first), extract candidate entities, and **report them back as structured data in its final message** (title, type, content, aliases, links, source project). Explicitly instruct each subagent: *do not call `remember` or `remember_batch` yourself, and do not write any files — only report your findings back.* This is the property that makes parallel extraction safe: only the phase below ever writes.

**Phase 3 — Reconcile + write (you, not a subagent).** Once all batches report back, go through the combined candidate list yourself: dedupe entities that are really the same thing (matching or near-matching titles/aliases — use judgment, not just exact string match), merge their content, and resolve shared entities referenced from multiple projects into a single node linked from each project. Then call `remember_batch` with the reconciled list. Finally run `mark_synced.js` for every project directory that was covered by this run.

## After syncing

Tell the user, briefly: how many projects were processed, how many entities were created vs. merged, and remind them the vault is at `${CLAUDE_MEMORY_VAULT_DIR:-~/ClaudeMemory-vault}` if they want to open it in Obsidian.
