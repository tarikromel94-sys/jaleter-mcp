import http from "node:http";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";

const server = new McpServer({
  name: "jaleter-mcp",
  version: "1.0.0"
});

server.registerTool(
  "budget-summary",
  {
    title: "Budget Summary",
    description: "Summarizes income, expenses, and remaining budget",
    inputSchema: {
      income: z.number(),
      expenses: z.number()
    }
  },
  async ({ income, expenses }) => {
    const remaining = income - expenses;

    return {
      content: [
        {
          type: "text",
          text: `Income: $${income}, expenses: $${expenses}, remaining: $${remaining}.`
        }
      ]
    };
  }
);

const httpServer = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith("/mcp")) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on("close", () => {
    transport.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Jaleter MCP server listening on ${PORT}`);
});