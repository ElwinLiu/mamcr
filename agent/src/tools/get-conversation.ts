import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getDb } from "../db/schema.js";
import { scopedTable } from "../db/scope.js";

interface ConvRow {
	conv_id: number;
	user_id: string;
	scenario_id: number;
	catalogue: string;
	mentioned_items: string;
	gt_items: string;
	summary: string | null;
}

interface TurnRow {
	turn: number;
	role: string;
	content: string;
	tags: string;
}

interface PrefRow {
	description: string;
}

interface ScenarioRow {
	body: string;
}

const getConversationParams = Type.Object({
	conv_id: Type.Number({ description: "Conversation ID" }),
});

export const getConversationTool: ToolDefinition<typeof getConversationParams> = {
	name: "get_conversation",
	label: "Get Conversation",
	description: "Retrieve full conversation transcript, metadata, and any extracted preference signals.",
	parameters: getConversationParams,
	async execute(_toolCallId, params) {
		const db = getDb();
		const convsTable = scopedTable("conversations");
		const turnsTable = scopedTable("conversation_turns");
		const prefsTable = scopedTable("user_preferences");

		const conv = db.prepare(`SELECT * FROM ${convsTable} WHERE conv_id = ?`).get(params.conv_id) as
			| ConvRow
			| undefined;
		if (!conv) {
			return {
				content: [{ type: "text" as const, text: `Conversation ${params.conv_id} not found.` }],
				details: {},
			};
		}

		const turns = db
			.prepare(`SELECT turn, role, content, tags FROM ${turnsTable} WHERE conv_id = ? ORDER BY turn`)
			.all(params.conv_id) as TurnRow[];

		const prefs = db
			.prepare(`SELECT description FROM ${prefsTable} WHERE source_conv_id = ?`)
			.all(params.conv_id) as PrefRow[];

		const scenario = db.prepare("SELECT body FROM scenarios WHERE scenario_id = ?").get(conv.scenario_id) as
			| ScenarioRow
			| undefined;

		const lines: string[] = [
			`## Conversation ${conv.conv_id}`,
			`User: ${conv.user_id} | Scenario: ${conv.scenario_id} | Catalogue: ${conv.catalogue}`,
			`Mentioned items: ${conv.mentioned_items}`,
		];

		if (scenario) {
			lines.push("", `### Scenario`, scenario.body);
		}

		if (conv.summary) {
			lines.push("", "### Summary", conv.summary);
		}

		lines.push("", "### Transcript");
		for (const turn of turns) {
			lines.push(`\n**Turn ${turn.turn} (${turn.role})**:`);
			lines.push(turn.content);
		}

		if (prefs.length > 0) {
			lines.push("", "### Extracted Preferences");
			for (const p of prefs) {
				lines.push(`- ${p.description}`);
			}
		}

		return { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
	},
};
