import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getDb } from "../db/schema.js";

interface UserRow {
	user_id: string;
	style_preferences: string;
	style_vibes: string;
	purchase_frequency: string;
	monthly_spend: string;
	best_colors: string;
	clothing_feel: string;
	comfort: number;
	style: number;
	practicality: number;
	trends: number;
	brand: number;
	self_expression: number;
	sustainability: number;
	price: number;
	color_importance: number;
}

interface PrefRow {
	description: string;
	source_conv_id: number;
}

const loadTasteProfileParams = Type.Object({
	user_id: Type.String({ description: "The seeker's ID (e.g. 's1')" }),
	exclude_conv_id: Type.Number({ description: "Conversation ID to exclude (the one being tested)" }),
});

export const loadTasteProfileTool: ToolDefinition<typeof loadTasteProfileParams> = {
	name: "load_taste_profile",
	label: "Load Taste Profile",
	description:
		"Load a user's pre-extracted preference profile from prior conversations, excluding the current test conversation.",
	parameters: loadTasteProfileParams,
	async execute(_toolCallId, params) {
		const db = getDb();

		const user = db.prepare("SELECT * FROM users WHERE user_id = ?").get(params.user_id) as UserRow | undefined;
		const prefs = db
			.prepare("SELECT description, source_conv_id FROM user_preferences WHERE user_id = ? AND source_conv_id != ?")
			.all(params.user_id, params.exclude_conv_id) as PrefRow[];

		const lines: string[] = ["## User Taste Profile"];

		if (user) {
			lines.push(
				"",
				"### Profile",
				`Style: ${user.style_preferences}`,
				`Vibes: ${user.style_vibes}`,
				`Colors: ${user.best_colors}`,
				`Clothing feel: ${user.clothing_feel}`,
				`Shopping: ${user.purchase_frequency}, ${user.monthly_spend}/mo`,
				"",
				"### Importance Weights (1-5)",
				`Comfort: ${user.comfort} | Style: ${user.style} | Practicality: ${user.practicality}`,
				`Trends: ${user.trends} | Brand: ${user.brand} | Self-expression: ${user.self_expression}`,
				`Sustainability: ${user.sustainability} | Price: ${user.price} | Color: ${user.color_importance}`,
			);
		} else {
			lines.push("", "(No profile found for this user)");
		}

		if (prefs.length > 0) {
			// Group by source conversation
			const byConv = new Map<number, string[]>();
			for (const p of prefs) {
				const list = byConv.get(p.source_conv_id) ?? [];
				list.push(p.description);
				byConv.set(p.source_conv_id, list);
			}

			lines.push("", `### Preferences from Prior Conversations (${prefs.length} signals)`);
			for (const [convId, descriptions] of byConv) {
				lines.push(`\nConversation ${convId}:`);
				for (const d of descriptions) {
					lines.push(`- ${d}`);
				}
			}
		} else {
			lines.push("", "### Preferences from Prior Conversations", "(No prior preferences found — cold start)");
		}

		return { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
	},
};
