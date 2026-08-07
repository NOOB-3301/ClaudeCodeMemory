#!/usr/bin/env node
// Phase 3a: mechanical, deterministic pre-merge over the combined candidate
// list gathered from all Phase 2 extraction subagents, before any of it
// reaches agent judgment. Exact-title duplicates (the common case — the
// same entity independently extracted by two subagents covering different
// projects/date ranges) are merged here with zero LLM judgment risk, so the
// judgment pass in Phase 3b only has to reason about genuinely ambiguous
// near-duplicates, in bounded sub-batches, regardless of total backfill size.
//
// Usage: node cluster_candidates.js <path-to-candidates.json>
// Input JSON: array of { type, title, content, links, tags, aliases, repo_path, source }
// Output (stdout): { autoMerged: [...], needsReview: [[candidate, candidate, ...], ...] }
import fs from "node:fs";

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

// Cheap similarity signal for flagging near-duplicates: share every
// significant (len > 3) normalized word from the shorter title/alias set.
// Deliberately conservative — false negatives (missed near-dupe) fall
// through to Phase 3b's judgment pass anyway via title-based clustering
// below; this only decides what's worth flagging for review vs. leaving
// as a standalone candidate.
function sharesSignificantWords(a, b) {
  const wordsA = normalize(a).split(" ").filter((w) => w.length > 3);
  const wordsB = normalize(b).split(" ").filter((w) => w.length > 3);
  if (!wordsA.length || !wordsB.length) return false;
  const [shorter, longer] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longerSet = new Set(longer);
  return shorter.every((w) => longerSet.has(w));
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node cluster_candidates.js <path-to-candidates.json>");
  process.exit(1);
}

const candidates = JSON.parse(fs.readFileSync(inputPath, "utf8"));

// Step 1: exact-match merge, keyed on normalized title (also checked
// against every alias so a candidate titled with what's really an alias
// of another still merges).
const exactGroups = new Map(); // normalized key -> candidate[]
for (const c of candidates) {
  const keys = new Set([normalize(c.title), ...(c.aliases || []).map(normalize)]);
  let placed = false;
  for (const key of keys) {
    if (exactGroups.has(key)) {
      exactGroups.get(key).push(c);
      placed = true;
      break;
    }
  }
  if (!placed) {
    const primaryKey = normalize(c.title);
    exactGroups.set(primaryKey, [c]);
  }
}

const autoMerged = [];
const singles = [];
for (const group of exactGroups.values()) {
  if (group.length === 1) {
    singles.push(group[0]);
    continue;
  }
  // Merge exact-match group mechanically: first candidate wins the title,
  // union everything else. Content concatenated with a separator so no
  // detail is silently dropped; upsertEntity's own merge logic on the
  // eventual remember_batch call handles the on-disk merge semantics.
  const [first, ...rest] = group;
  autoMerged.push({
    type: first.type,
    title: first.title,
    content: [first, ...rest].map((c) => c.content).join("\n\n"),
    links: [...new Set(group.flatMap((c) => c.links || []))],
    tags: [...new Set(group.flatMap((c) => c.tags || []))],
    aliases: [...new Set(group.flatMap((c) => c.aliases || []).concat(rest.map((c) => c.title)))],
    repo_path: first.repo_path || rest.find((c) => c.repo_path)?.repo_path,
    source: first.source,
    _mergedFrom: group.length,
  });
}

// Step 2: among the remaining singles (no exact-title match found), flag
// near-duplicate clusters for judgment review. O(n^2) over singles only,
// which is the whole point of doing the exact-match pass first.
const reviewed = new Set();
const needsReview = [];
for (let i = 0; i < singles.length; i++) {
  if (reviewed.has(i)) continue;
  const cluster = [singles[i]];
  for (let j = i + 1; j < singles.length; j++) {
    if (reviewed.has(j)) continue;
    if (sharesSignificantWords(singles[i].title, singles[j].title)) {
      cluster.push(singles[j]);
      reviewed.add(j);
    }
  }
  if (cluster.length > 1) {
    reviewed.add(i);
    needsReview.push(cluster);
  }
}

const clusteredIndices = new Set(needsReview.flat());
const untouched = singles.filter((c) => !clusteredIndices.has(c));

console.log(
  JSON.stringify(
    {
      autoMerged: [...autoMerged, ...untouched],
      needsReview,
      summary: {
        totalCandidates: candidates.length,
        autoMergedGroups: autoMerged.length,
        untouchedSingles: untouched.length,
        needsReviewClusters: needsReview.length,
      },
    },
    null,
    2
  )
);
