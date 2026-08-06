#!/usr/bin/env node
// Phase 0: cheap, deterministic recon over ~/.claude/projects — filesystem
// stats only, no file content is read. Outputs a per-project volume table
// so the skill can decide serial vs. fan-out and, if fan-out, how to
// partition. Byte-size delta vs. the last recorded sync-state size is used
// as the "new work" signal instead of message/line counts, since Claude
// Code's transcript JSONL schema is internal and shouldn't be parsed here.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function vaultDir() {
  return process.env.CLAUDE_MEMORY_VAULT_DIR || path.join(os.homedir(), "ClaudeMemory-vault");
}

function syncStatePath() {
  return path.join(vaultDir(), ".claude-memory-sync-state.json");
}

function loadSyncState() {
  const file = syncStatePath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

const days = Number(process.argv[2]) || 7;
const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
const projectsRoot = path.join(os.homedir(), ".claude", "projects");
const state = loadSyncState();

const projects = [];
if (fs.existsSync(projectsRoot)) {
  for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(projectsRoot, entry.name);
    const sessionFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
    if (sessionFiles.length === 0) continue;

    let sessionCount = 0;
    let newSessionCount = 0;
    let totalNewBytes = 0;
    let newestMtime = 0;
    const newSessionFiles = [];

    for (const file of sessionFiles) {
      const filePath = path.join(projectDir, file);
      const stat = fs.statSync(filePath);
      sessionCount++;
      if (stat.mtimeMs < cutoff) continue;

      const prevSize = state[filePath]?.size || 0;
      const newBytes = Math.max(0, stat.size - prevSize);
      if (newBytes > 0) {
        newSessionCount++;
        totalNewBytes += newBytes;
        newSessionFiles.push(filePath);
        newestMtime = Math.max(newestMtime, stat.mtimeMs);
      }
    }

    if (newSessionCount > 0) {
      projects.push({
        projectDir,
        encodedDirName: entry.name,
        sessionCount,
        newSessionCount,
        totalNewBytes,
        newSessionFiles,
        newestMtime: newestMtime ? new Date(newestMtime).toISOString() : null,
      });
    }
  }
}

const totals = projects.reduce(
  (acc, p) => ({
    newSessionCount: acc.newSessionCount + p.newSessionCount,
    totalNewBytes: acc.totalNewBytes + p.totalNewBytes,
  }),
  { newSessionCount: 0, totalNewBytes: 0 }
);

console.log(
  JSON.stringify(
    {
      days,
      vaultDir: vaultDir(),
      note:
        "encodedDirName is Claude Code's path-encoded project directory name and is LOSSY (dashes in the " +
        "real path are indistinguishable from path separators). Do not reverse-engineer repo_path from it — " +
        "read the actual cwd out of the transcript content instead.",
      projects,
      totals,
    },
    null,
    2
  )
);
