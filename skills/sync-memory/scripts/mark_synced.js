#!/usr/bin/env node
// Deterministic sync-state update, run once a project's new sessions have
// actually been extracted and written to the vault. Kept as a script
// (rather than the LLM hand-editing the state file) so state never gets
// corrupted or drifts from what was really processed.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function vaultDir() {
  return process.env.CLAUDE_MEMORY_VAULT_DIR || path.join(os.homedir(), "ClaudeMemory-vault");
}

function syncStatePath() {
  return path.join(vaultDir(), ".claude-memory-sync-state.json");
}

const projectDirs = process.argv.slice(2);
if (projectDirs.length === 0) {
  console.error("Usage: mark_synced.js <projectDir1> [projectDir2 ...]");
  process.exit(1);
}

const stateFile = syncStatePath();
let state = {};
if (fs.existsSync(stateFile)) {
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    state = {};
  }
}

let updated = 0;
for (const projectDir of projectDirs) {
  if (!fs.existsSync(projectDir)) continue;
  for (const file of fs.readdirSync(projectDir)) {
    if (!file.endsWith(".jsonl")) continue;
    const filePath = path.join(projectDir, file);
    const stat = fs.statSync(filePath);
    state[filePath] = { size: stat.size, syncedAt: new Date().toISOString() };
    updated++;
  }
}

fs.mkdirSync(vaultDir(), { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
console.log(JSON.stringify({ updatedFiles: updated, stateFile }, null, 2));
