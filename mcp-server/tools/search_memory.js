import { searchMemory } from "../vault.js";

export default {
  name: "search_memory",
  description:
    "Full-text/keyword search across the ENTIRE memory vault, not just the current repo. Use this " +
    "when get_project_context didn't surface what you need, or when the topic might live outside the " +
    "current repo's direct links (e.g. a database or library shared across multiple projects).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Keywords to search for." },
      type: {
        type: "string",
        description: "Optional filter: project, convention, decision, permission, preference, session, or a domain-specific type.",
      },
    },
    required: ["query"],
  },
  async handler(args) {
    return { results: await searchMemory(args.query, args.type) };
  },
};
