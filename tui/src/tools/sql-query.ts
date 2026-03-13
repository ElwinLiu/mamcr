import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getDb } from "../db/schema.js";

const BLOCKED_TABLES = ["ratings", "item_embeddings"];

function validateQuery(query: string): string | null {
	const trimmed = query.trim().toUpperCase();

	if (!trimmed.startsWith("SELECT")) {
		return "Only SELECT queries are allowed (read-only access).";
	}

	for (const table of BLOCKED_TABLES) {
		// Check for table name in the query (case-insensitive, word boundary)
		const pattern = new RegExp(`\\b${table}\\b`, "i");
		if (pattern.test(query)) {
			return `Access to the '${table}' table is not allowed.`;
		}
	}

	return null;
}

function formatResults(rows: Record<string, unknown>[]): string {
	if (rows.length === 0) return "No results.";

	const columns = Object.keys(rows[0]);

	// Truncate long values for display
	const formatValue = (v: unknown): string => {
		if (v === null || v === undefined) return "NULL";
		const str = String(v);
		return str.length > 120 ? str.slice(0, 117) + "..." : str;
	};

	// Header
	const header = columns.join(" | ");
	const separator = columns.map((c) => "-".repeat(Math.max(c.length, 3))).join("-|-");

	// Rows
	const rowLines = rows.slice(0, 50).map((row) => columns.map((c) => formatValue(row[c])).join(" | "));

	let result = `${header}\n${separator}\n${rowLines.join("\n")}`;
	if (rows.length > 50) {
		result += `\n\n... (${rows.length - 50} more rows truncated)`;
	}
	return result;
}

const sqlQueryParams = Type.Object({
	query: Type.String({ description: "SQL SELECT query" }),
});

export const sqlQueryTool: ToolDefinition<typeof sqlQueryParams> = {
	name: "sql_query",
	label: "SQL Query",
	description: `Execute a read-only SQL query against the database.
Available tables: users, items, scenarios, conversations, conversation_turns, user_preferences.
The 'ratings' table is NOT accessible (ground truth is hidden from agents).
Use this for progressive disclosure: start with basic queries, drill into details as needed.`,
	parameters: sqlQueryParams,
	async execute(_toolCallId, params) {
		const error = validateQuery(params.query);
		if (error) {
			return { content: [{ type: "text" as const, text: `Error: ${error}` }], details: {} };
		}

		try {
			const db = getDb();
			const rows = db.prepare(params.query).all() as Record<string, unknown>[];
			const text = `## Query Results\n\n\`\`\`sql\n${params.query}\n\`\`\`\n\n${formatResults(rows)}\n\n(${rows.length} row${rows.length !== 1 ? "s" : ""})`;
			return { content: [{ type: "text" as const, text }], details: {} };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { content: [{ type: "text" as const, text: `SQL Error: ${msg}` }], details: {} };
		}
	},
};
