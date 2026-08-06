import { listRelated } from "../vault.js";

export default {
  name: "list_related",
  description:
    "Graph traversal: list notes wikilinked to/from a given entity, up to N hops out. Use this to " +
    "explore the neighborhood of an entity beyond what get_project_context already expanded.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Exact title or alias of the starting entity." },
      depth: { type: "number", description: "How many hops to traverse (default 1, max 3)." },
    },
    required: ["name"],
  },
  async handler(args) {
    const depth = Math.min(Math.max(args.depth || 1, 1), 3);
    return listRelated(args.name, depth);
  },
};
