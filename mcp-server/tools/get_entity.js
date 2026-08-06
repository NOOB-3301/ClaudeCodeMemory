import { getEntity } from "../vault.js";

export default {
  name: "get_entity",
  description:
    "Fetch the full content of one memory note by its exact title or a known alias. Use this after " +
    "search_memory or get_project_context surfaces a title you want the full detail on.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Exact title or alias of the note." },
    },
    required: ["name"],
  },
  async handler(args) {
    return getEntity(args.name);
  },
};
