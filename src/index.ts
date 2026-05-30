#!/usr/bin/env node
/**
 * vibie-mcp — Vibie 를 위한 MCP server.
 *
 * 사용:
 *   npx vibie-mcp
 *
 * Claude Desktop / Cursor config 예시:
 *   {
 *     "mcpServers": {
 *       "vibie": { "command": "npx", "args": ["-y", "vibie-mcp"] }
 *     }
 *   }
 *
 * 첫 사용 시 사용자에게 https://vibie.io/device 인증 URL 안내 — credentials 는
 * ~/.vibie/credentials.json 에 자동 저장 (chmod 0600).
 *
 * Env (옵션):
 *   VIBIE_API_BASE — default https://vibie.io. 로컬 dev 시 http://localhost:3000.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { toolDefinitions, handleToolCall } from "./tools.js";
import { runSetup } from "./setup.js";

// 서브커맨드 분기. `npx vibie-mcp setup` 으로 호출 시 setup 모드.
// 그 외엔 stdio MCP server 로 동작 (Claude Desktop / Cursor 가 spawn).
const subcommand = process.argv[2];
if (subcommand === "setup") {
  await runSetup();
  process.exit(0);
}

const server = new Server(
  {
    name: "vibie",
    version: "0.2.2"
  },
  {
    capabilities: { tools: {} }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  return handleToolCall(name, args);
});

const transport = new StdioServerTransport();
await server.connect(transport);
