const express = require("express");
const app = express();

app.use(express.json());

app.get("/mcp", (req, res) => {
  res.json({
    name: "jaleter-mcp",
    description: "Budgeting MCP server",
    tools: [
      {
        name: "budget-summary",
        description: "Summarizes income, expenses, and remaining budget",
        input_schema: {
          type: "object",
          properties: {
            income: { type: "number" },
            expenses: { type: "number" }
          },
          required: ["income", "expenses"]
        }
      }
    ]
  });
});

app.get("/", (req, res) => {
  res.send("Jaleter MCP Server Running");
});

app.post("/invoke", (req, res) => {
  const { tool, input } = req.body;

  if (tool === "budget-summary") {
    const income = Number(input?.income || 0);
    const expenses = Number(input?.expenses || 0);
    const remaining = income - expenses;

    return res.json({
      income,
      expenses,
      remaining,
      message: `You have $${remaining} left in your budget.`
    });
  }

  res.status(400).json({ error: "Tool not found" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
