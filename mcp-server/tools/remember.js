import { remember } from "../vault.js";

export default {
  name: "remember",
  description:
    "Persist a durable fact to memory RIGHT NOW, mid-conversation. Call this proactively whenever the " +
    "user tells you something worth keeping across sessions: an architecture decision, a DB schema " +
    "detail, a standing permission ('always allow X in this repo'), a coding convention, or a personal " +
    "working preference. Don't wait for the user to ask you to remember something. If an entity with " +
    "this title or a matching alias already exists, this merges into it instead of creating a " +
    "duplicate — so reuse the same title you've seen before when updating something.",
  inputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: "project | convention | decision | permission | preference | session | a domain-specific type (e.g. schema).",
      },
      title: { type: "string", description: "Canonical, stable title for this entity, e.g. 'Schema - orders table' or 'Permission - auto-approve npm in billing-service'." },
      content: { type: "string", description: "The fact itself, in prose. Markdown is fine." },
      links: {
        type: "array",
        items: { type: "string" },
        description: "Titles of other entities this relates to (e.g. the owning project). Creates [[wikilinks]].",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Call list_tags first and prefer reusing an existing tag over inventing a near-duplicate; only add a new tag when no existing one fits.",
      },
      aliases: { type: "array", items: { type: "string" }, description: "Other names this entity might be referred to by." },
      repo_path: { type: "string", description: "Only for type: project — absolute path used to anchor get_project_context lookups." },
    },
    required: ["type", "title", "content"],
  },
  async handler(args) {
    return remember(args);
  },
};
