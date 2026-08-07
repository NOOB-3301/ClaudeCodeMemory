import { listTags } from "../vault.js";

export default {
  name: "list_tags",
  description:
    "List every distinct tag currently used across the memory vault, with usage counts, sorted most-used " +
    "first. Call this before assigning tags on a new remember/remember_batch call — reuse an existing tag " +
    "when it fits rather than inventing a near-duplicate (e.g. 'auth' vs 'authentication'). There is no " +
    "fixed tag vocabulary; this is just visibility into what's already there so the choice stays consistent.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  async handler() {
    return { tags: await listTags() };
  },
};
