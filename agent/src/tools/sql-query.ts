import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getDb } from "../db/schema.js";

import { getActiveScope, scopedTable } from "../db/scope.js";

/** Tables/views the agent is allowed to query. */
const ALWAYS_ALLOWED = ["users", "items", "scenarios"];
const SCOPED_VIEWS = ["v_user_preferences", "v_conversations", "v_conversation_turns"];
const UNSCOPED_FALLBACKS = ["user_preferences", "conversations", "conversation_turns"];
const BLOCKED_COLUMNS = ["gt_items"];

function validateQuery(query: string): string | null {
	const trimmed = query.trim().toUpperCase();

	if (!trimmed.startsWith("SELECT")) {
		return "Only SELECT queries are allowed (read-only access).";
	}

	// Block ground-truth columns regardless of scope
	for (const col of BLOCKED_COLUMNS) {
		if (new RegExp(`\\b${col}\\b`, "i").test(query)) {
			return `Access to the '${col}' column is not allowed (ground truth is hidden).`;
		}
	}

	const inScope = getActiveScope() !== null;
	const allowed = inScope
		? [...ALWAYS_ALLOWED, ...SCOPED_VIEWS]
		: [...ALWAYS_ALLOWED, ...UNSCOPED_FALLBACKS];

	// Reject identifier quoting that could bypass table validation
	if (/[`"[\]]/.test(query)) {
		return "Quoted identifiers (backticks, double quotes, brackets) are not allowed.";
	}

	// Extract all table identifiers: after FROM/JOIN and comma-separated lists
	const tables: string[] = [];
	const tablePattern = /\b(?:FROM|JOIN)\s+([\w]+(?:\s*,\s*[\w]+)*)/gi;
	let match;
	while ((match = tablePattern.exec(query)) !== null) {
		for (const name of match[1].split(",")) {
			tables.push(name.trim().toLowerCase());
		}
	}

	for (const table of tables) {
		if (!table || allowed.includes(table)) continue;
		if (inScope && UNSCOPED_FALLBACKS.includes(table)) {
			const view = `v_${table}`;
			return `During simulation, use '${view}' instead of '${table}' to prevent data contamination.`;
		}
		return `Access to '${table}' is not allowed.`;
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
Always-available tables: users, items, scenarios.
During simulation, use scoped views: v_user_preferences, v_conversations, v_conversation_turns.
These views automatically exclude the test conversation's data to prevent contamination.
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
