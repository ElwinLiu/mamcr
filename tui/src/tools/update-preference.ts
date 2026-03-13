import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getDb } from "../db/schema.js";

const updatePreferenceParams = Type.Object({
	user_id: Type.String({ description: "The seeker's ID (e.g. 's1')" }),
	conv_id: Type.Number({ description: "Current conversation ID (used as source_conv_id)" }),
	description: Type.String({
		description:
			'Natural language preference, e.g. "Prefers lightweight, slim-fit jackets — disliked Item 7 for being too bulky"',
	}),
});

export const updatePreferenceTool: ToolDefinition<typeof updatePreferenceParams> = {
	name: "update_preference",
	label: "Update Preference",
	description:
		'Persist a preference signal as a descriptive string to the database. Use for recording user preferences discovered during conversation.',
	parameters: updatePreferenceParams,
	async execute(_toolCallId, params) {
		const db = getDb();

		db.prepare("INSERT INTO user_preferences (user_id, source_conv_id, description) VALUES (?, ?, ?)").run(
			params.user_id,
			params.conv_id,
			params.description,
		);

		const count = db
			.prepare("SELECT COUNT(*) as cnt FROM user_preferences WHERE user_id = ?")
			.get(params.user_id) as { cnt: number };

		const text = `Preference recorded for ${params.user_id} (conv ${params.conv_id}). Total preferences: ${count.cnt}.`;

		return { content: [{ type: "text" as const, text }], details: {} };
	},
};
