import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import getProjectContext from "./tools/get_project_context.js";
import searchMemory from "./tools/search_memory.js";
import getEntity from "./tools/get_entity.js";
import listRelated from "./tools/list_related.js";
import remember from "./tools/remember.js";
import rememberBatch from "./tools/remember_batch.js";

const tools = [getProjectContext, searchMemory, getEntity, listRelated, remember, rememberBatch];
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

const server = new Server(
  { name: "claude-code-memory", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolsByName[request.params.name];
  if (!tool) {
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }] };
  }
  try {
    const result = await tool.handler(request.params.arguments || {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: `${tool.name} failed: ${err.message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
