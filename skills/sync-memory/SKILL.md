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

## Phase 0.5 — Tag vocabulary (cheap, deterministic)

Call the `list_tags` MCP tool once and keep the result in context for the rest of the run. There is no fixed tag vocabulary anywhere in this system — when assigning tags to any entity below (Serial or Fan-out path), reuse an existing tag if it semantically fits rather than minting a near-duplicate (e.g. don't create `authentication` if `auth` already exists and means the same thing). Only add a new tag when nothing in the existing vocabulary fits. This is a judgment call each time, not a lookup against a fixed list.

## Decide: serial or fan-out

- **Small volume** (rough guide: fewer than ~5 projects have new sessions, or total new bytes is small, say under a few hundred KB) → skip straight to **Serial path** below.
- **Large volume** (a true first run, or a long gap since the last sync) → use **Fan-out path** below.

Use judgment on the exact cutoff — the point is to avoid spinning up parallel subagents for a two-session catch-up, and to avoid trying to process a huge first-time backfill in one context window.

## Serial path (small deltas)

For each project with new sessions:
1. Read the new portion of its transcript file(s) (the ones listed in `newSessionFiles`). Since the JSONL schema is internal and can vary by version, inspect one sample line first (`head -n 1 <file>`) to see the current field shapes before parsing — look for a `cwd`-like field to get the *real* repo path (do not derive it from the recon-reported `encodedDirName`, which is lossy).
2. Extract durable facts: architecture summary → `project` entity (set `repo_path`), conventions, decisions, permissions granted, preferences expressed, notable schema/domain facts, and a short `session` summary entity linking back to the project. Tag each per Phase 0.5 (reuse existing tags where they fit).
3. Before creating a new entity, check whether it already exists (`search_memory` / `get_entity`) so you reuse the same title rather than creating a near-duplicate.
4. Call `remember` (or `remember_batch` for the whole project's batch) to persist everything.
5. Once persisted, run:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/sync-memory/scripts/mark_synced.js" <projectDir>
   ```
   to advance that project's sync-state marker. Only mark a project synced after its facts are actually written.

## Fan-out path (large volume)

**Phase 1 — Plan.** Look at the recon volume table and bin-pack the work into batches — group small projects together, split a single huge project's `newSessionFiles` by date range if needed. Aim for roughly even-sized batches, capped at ~4-5 concurrent subagents at a time (run in more than one wave if there are more batches than that).

**Phase 2 — Extract (subagents).** For each batch, launch an Agent with instructions to: read that batch's transcripts (same field-discovery caveat as the serial path — inspect a sample line first), extract candidate entities, and **report them back as structured data in its final message** (title, type, content, aliases, links, tags — reusing the Phase 0.5 vocabulary where it fits — source project). Explicitly instruct each subagent: *do not call `remember` or `remember_batch` yourself, and do not write any files — only report your findings back.* This is the property that makes parallel extraction safe: only Phase 3 ever writes.

**Phase 3 — Reconcile + write.** Reconcile scales with volume instead of being one flat unbounded task — split it into three sub-steps. The point of 3a is to keep 3b's per-agent context bounded no matter how large the backfill is.

- **3a — Mechanical pre-cluster (deterministic, no agent judgment).** Collect every subagent's reported candidates into one JSON array and write it to a temp file. Run:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/skills/sync-memory/scripts/cluster_candidates.js" <path-to-candidates.json>
  ```
  This merges exact-title/alias duplicates mechanically (the common case: the same entity extracted independently by two subagents) and flags everything else either as an untouched single or a `needsReview` cluster of near-matching titles. Nothing here is skimmed regardless of total candidate count — it's plain string normalization, not LLM judgment.
- **3b — Judgment pass, sub-batched.** Only the `needsReview` clusters go to agent judgment, capped at ~30-40 clusters per sub-batch (a few concurrent subagents at a time, same fan-out pattern as Phase 2). Each judgment agent decides merge-vs-separate per cluster in its slice — matching or near-matching titles/aliases, using judgment, not just exact string match — and returns the finalized entity list for that slice. This bounds any single agent's reconcile context to one sub-batch, never the whole run.
- **3c — Chunked write.** Concatenate `autoMerged` from 3a with every judgment sub-batch's output from 3b. Resolve any entity referenced from multiple projects into a single node linked from each. Call `remember_batch` in chunks of ~30-40 entities rather than one giant call. Finally run `mark_synced.js` for every project directory covered by this run.

## After syncing

Tell the user, briefly: how many projects were processed, how many entities were created vs. merged (split out how many merged mechanically in 3a vs. via judgment in 3b, if the fan-out path ran), and remind them the vault is at `${CLAUDE_MEMORY_VAULT_DIR:-~/ClaudeMemory-vault}` if they want to open it in Obsidian.
