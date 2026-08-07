import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";

const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g;
const EXPAND_TYPES = new Set(["convention", "decision", "permission", "preference", "schema"]);
const MAX_EXPANDED_ENTITIES = 25;
const MAX_ENTITY_CONTENT_CHARS = 2000;

export function vaultDir() {
  return process.env.CLAUDE_MEMORY_VAULT_DIR || path.join(os.homedir(), "ClaudeMemory-vault");
}

async function ensureVaultSeeded(dir) {
  if (fssync.existsSync(dir)) return;
  await fs.mkdir(dir, { recursive: true });
  const templateDir = path.join(new URL(".", import.meta.url).pathname, "..", "vault-template");
  if (fssync.existsSync(templateDir)) {
    await fs.cp(templateDir, dir, { recursive: true });
  }
}

function slugifyTitle(title) {
  return title.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };
  const [, fmBlock, body] = match;
  const frontmatter = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    frontmatter[key] = parseScalarOrArray(rawValue.trim());
  }
  return { frontmatter, body };
}

function parseScalarOrArray(value) {
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((s) => stripQuotes(s.trim())).filter(Boolean);
  }
  return stripQuotes(value);
}

function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function serializeFrontmatter(fm) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => v).join(", ")}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function extractLinks(body) {
  const links = new Set();
  let m;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(body))) {
    links.add(m[1].trim());
  }
  return [...links];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Scans the vault fresh on every call. Vault sizes here are personal-scale
 * (hundreds, not millions of notes), so re-parsing beats the bug surface of
 * a stale in-memory cache.
 */
export async function loadIndex() {
  const dir = vaultDir();
  await ensureVaultSeeded(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const notes = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(dir, entry.name);
    const raw = await fs.readFile(filePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    const title = entry.name.slice(0, -3);
    notes.push({
      title,
      filePath,
      type: frontmatter.type || "note",
      tags: toArray(frontmatter.tags),
      aliases: toArray(frontmatter.aliases),
      created: frontmatter.created || "",
      updated: frontmatter.updated || "",
      source: frontmatter.source || "sync",
      repo_path: frontmatter.repo_path || "",
      frontmatter,
      body,
      links: extractLinks(body),
    });
  }

  const byTitle = new Map();
  const byAlias = new Map();
  const byRepoPath = new Map();
  for (const note of notes) {
    byTitle.set(note.title.toLowerCase(), note);
    for (const alias of note.aliases) byAlias.set(alias.toLowerCase(), note);
    if (note.type === "project" && note.repo_path) {
      byRepoPath.set(normalizeRepoPath(note.repo_path), note);
    }
  }

  return { dir, notes, byTitle, byAlias, byRepoPath };
}

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  return [v];
}

export function normalizeRepoPath(p) {
  return path.resolve(p).replace(/\/$/, "");
}

export function resolveEntity(index, nameOrAlias) {
  const key = nameOrAlias.trim().toLowerCase();
  return index.byTitle.get(key) || index.byAlias.get(key) || null;
}

export function fuzzyFindEntities(index, nameOrAlias, limit = 5) {
  const key = nameOrAlias.trim().toLowerCase();
  const scored = [];
  for (const note of index.notes) {
    const hay = [note.title, ...note.aliases].join(" ").toLowerCase();
    if (hay.includes(key)) scored.push(note);
  }
  return scored.slice(0, limit);
}

/**
 * Returns a project note plus a bounded 1-hop expansion of its wikilinks,
 * prioritized by type so high-value context (schema/decisions/conventions/
 * permissions) comes back inline and low-value context (sessions) comes
 * back as titles only.
 */
export async function getProjectContext(repoPath) {
  const index = await loadIndex();
  const project = index.byRepoPath.get(normalizeRepoPath(repoPath));
  if (!project) {
    return { found: false, message: `No project note found for repo_path ${repoPath}. It may not have been synced yet.` };
  }

  const expanded = [];
  const titlesOnly = [];
  let expandedCount = 0;
  for (const linkTitle of project.links) {
    const linked = resolveEntity(index, linkTitle);
    if (!linked) {
      titlesOnly.push(linkTitle);
      continue;
    }
    if (EXPAND_TYPES.has(linked.type) && expandedCount < MAX_EXPANDED_ENTITIES) {
      expanded.push({
        title: linked.title,
        type: linked.type,
        content: linked.body.trim().slice(0, MAX_ENTITY_CONTENT_CHARS),
      });
      expandedCount++;
    } else {
      titlesOnly.push(linked.title);
    }
  }

  return {
    found: true,
    project: { title: project.title, type: project.type, content: project.body.trim() },
    expanded,
    titlesOnly,
  };
}

export async function searchMemory(query, type) {
  const index = await loadIndex();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const results = [];
  for (const note of index.notes) {
    if (type && note.type !== type) continue;
    const titleHay = note.title.toLowerCase();
    const aliasHay = note.aliases.join(" ").toLowerCase();
    const tagHay = note.tags.join(" ").toLowerCase();
    const bodyHay = note.body.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (titleHay.includes(term)) score += 3;
      if (aliasHay.includes(term)) score += 3;
      if (tagHay.includes(term)) score += 2;
      if (bodyHay.includes(term)) score += 1;
    }
    if (score > 0) {
      const idx = bodyHay.indexOf(terms[0] || "");
      const snippet = idx >= 0 ? note.body.slice(Math.max(0, idx - 60), idx + 140).trim() : note.body.slice(0, 140).trim();
      results.push({ title: note.title, type: note.type, score, snippet });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

/**
 * Aggregates the distinct tag vocabulary already in use across the vault,
 * so callers (live `remember` calls, the sync skill) can reuse an existing
 * tag instead of minting a near-duplicate. No fixed vocabulary is enforced
 * anywhere — this just gives visibility so the choice stays autonomous.
 */
export async function listTags() {
  const index = await loadIndex();
  const counts = new Map();
  for (const note of index.notes) {
    for (const tag of note.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function getEntity(name) {
  const index = await loadIndex();
  const note = resolveEntity(index, name);
  if (note) {
    return { found: true, title: note.title, type: note.type, content: note.body.trim(), tags: note.tags, aliases: note.aliases, updated: note.updated };
  }
  const candidates = fuzzyFindEntities(index, name);
  return { found: false, candidates: candidates.map((c) => ({ title: c.title, type: c.type })) };
}

export async function listRelated(name, depth = 1) {
  const index = await loadIndex();
  const start = resolveEntity(index, name);
  if (!start) return { found: false, candidates: fuzzyFindEntities(index, name).map((c) => c.title) };

  const visited = new Set([start.title.toLowerCase()]);
  const results = [];
  let frontier = [start];
  for (let d = 1; d <= depth; d++) {
    const next = [];
    for (const note of frontier) {
      for (const linkTitle of note.links) {
        const linked = resolveEntity(index, linkTitle);
        const key = (linked ? linked.title : linkTitle).toLowerCase();
        if (visited.has(key)) continue;
        visited.add(key);
        if (linked) {
          results.push({ title: linked.title, type: linked.type, distance: d });
          next.push(linked);
        } else {
          results.push({ title: linkTitle, type: "unresolved", distance: d });
        }
      }
    }
    frontier = next;
  }
  return { found: true, title: start.title, related: results };
}

/**
 * The single write path for every vault mutation, called both by the live
 * `remember` tool and by the sync skill's batch reconcile phase. Dedupes
 * against existing title/alias matches and merges rather than duplicating.
 */
export async function upsertEntity(entity, index) {
  const idx = index || (await loadIndex());
  const { type, title, content, links = [], tags = [], aliases = [], repo_path, source = "live" } = entity;
  if (!title || !content) throw new Error("upsertEntity requires title and content");

  const existing = resolveEntity(idx, title) || aliases.map((a) => resolveEntity(idx, a)).find(Boolean);

  if (existing) {
    const mergedTags = Array.from(new Set([...existing.tags, ...tags]));
    const mergedAliases = Array.from(new Set([...existing.aliases, ...aliases, title].filter((t) => t.toLowerCase() !== existing.title.toLowerCase())));
    const fm = {
      type: existing.type,
      tags: mergedTags,
      aliases: mergedAliases,
      created: existing.created,
      updated: today(),
      source: existing.source === "live" ? "live" : source,
    };
    if (existing.repo_path || repo_path) fm.repo_path = existing.repo_path || repo_path;

    const existingLinkSet = new Set(existing.links.map((l) => l.toLowerCase()));
    const newLinks = links.filter((l) => !existingLinkSet.has(l.toLowerCase()));
    let body = existing.body.trimEnd();
    body += `\n\n## Update ${today()}\n${content.trim()}`;
    if (newLinks.length) {
      body += `\n\n## Related\n${newLinks.map((l) => `- [[${l}]]`).join("\n")}`;
    }

    const raw = `${serializeFrontmatter(fm)}\n\n${body.trim()}\n`;
    await fs.writeFile(existing.filePath, raw, "utf8");
    idx.notes = idx.notes.filter((n) => n !== existing);
    const updatedNote = { ...existing, tags: mergedTags, aliases: mergedAliases, updated: fm.updated, repo_path: fm.repo_path || "", body, links: [...existing.links, ...newLinks] };
    idx.notes.push(updatedNote);
    idx.byTitle.set(updatedNote.title.toLowerCase(), updatedNote);
    for (const a of mergedAliases) idx.byAlias.set(a.toLowerCase(), updatedNote);
    if (fm.repo_path) idx.byRepoPath.set(normalizeRepoPath(fm.repo_path), updatedNote);
    return { action: "merged", title: updatedNote.title, filePath: existing.filePath };
  }

  const fileTitle = slugifyTitle(title);
  const filePath = path.join(idx.dir, `${fileTitle}.md`);
  const fm = {
    type: type || "note",
    tags,
    aliases,
    created: today(),
    updated: today(),
    source,
  };
  if (repo_path) fm.repo_path = repo_path;

  let body = content.trim();
  if (links.length) {
    body += `\n\n## Related\n${links.map((l) => `- [[${l}]]`).join("\n")}`;
  }
  const raw = `${serializeFrontmatter(fm)}\n\n${body}\n`;
  await fs.writeFile(filePath, raw, "utf8");

  const newNote = { title: fileTitle, filePath, type: fm.type, tags, aliases, created: fm.created, updated: fm.updated, source, repo_path: repo_path || "", frontmatter: fm, body, links };
  idx.notes.push(newNote);
  idx.byTitle.set(fileTitle.toLowerCase(), newNote);
  for (const a of aliases) idx.byAlias.set(a.toLowerCase(), newNote);
  if (repo_path) idx.byRepoPath.set(normalizeRepoPath(repo_path), newNote);
  return { action: "created", title: fileTitle, filePath };
}

export async function remember(entity) {
  const index = await loadIndex();
  return upsertEntity(entity, index);
}

export async function rememberBatch(entities) {
  const index = await loadIndex();
  const results = [];
  for (const entity of entities) {
    results.push(await upsertEntity(entity, index));
  }
  return results;
}
