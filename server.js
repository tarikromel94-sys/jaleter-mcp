import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Create MCP server
const server = new McpServer({
  name: "jaleter-mcp",
  version: "1.0.0",
});

// Register tool
server.registerTool(
  "budget-summary",
  {
    title: "Budget Summary",
    description: "Summarizes income, expenses, and remaining budget",
    inputSchema: {
      income: z.number(),
      expenses: z.number(),
    },
  },
  async ({ income, expenses }) => {
    const remaining = income - expenses;

    return {
      content: [
        {
          type: "text",
          text: `Income: $${income}, expenses: $${expenses}, remaining: $${remaining}.`,
        },
      ],
    };
  }
);

// Create HTTP server
const httpServer = http.createServer(async (req, res) => {
  // Only allow MCP route
  if (!req.url.startsWith("/mcp")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
});

// Start server
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Jaleter MCP server running on port ${PORT}`);
});