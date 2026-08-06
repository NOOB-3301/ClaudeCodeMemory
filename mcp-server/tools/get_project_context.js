import { getProjectContext } from "../vault.js";

export default {
  name: "get_project_context",
  description:
    "Call this FIRST, before starting any task in a repo you haven't already touched this session. " +
    "Returns everything remembered about the repo at the given path: its architecture summary plus " +
    "linked conventions, decisions, standing permissions, and domain knowledge (e.g. DB schema) " +
    "expanded inline, so you don't need to ask the user to re-explain things they've already told " +
    "Claude Code in a previous session. Pass the repo's absolute working directory path.",
  inputSchema: {
    type: "object",
    properties: {
      repo_path: {
        type: "string",
        description: "Absolute path to the repository's working directory (e.g. the current cwd).",
      },
    },
    required: ["repo_path"],
  },
  async handler(args) {
    return getProjectContext(args.repo_path);
  },
};
