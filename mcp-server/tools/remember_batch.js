import { rememberBatch } from "../vault.js";

export default {
  name: "remember_batch",
  description:
    "Batch version of remember, for persisting many entities at once (e.g. the reconcile phase of a " +
    "/sync-memory run). Same dedup/merge logic as remember, applied in order — later entities in the " +
    "batch can merge into earlier ones from the same call.",
  inputSchema: {
    type: "object",
    properties: {
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            links: { type: "array", items: { type: "string" } },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Call list_tags first and prefer reusing an existing tag over inventing a near-duplicate; only add a new tag when no existing one fits.",
            },
            aliases: { type: "array", items: { type: "string" } },
            repo_path: { type: "string" },
          },
          required: ["type", "title", "content"],
        },
      },
    },
    required: ["entities"],
  },
  async handler(args) {
    return { results: await rememberBatch(args.entities) };
  },
};
