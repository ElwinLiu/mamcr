import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getDb } from "../db/schema.js";

interface ItemRow {
	item_id: number;
	name: string;
	brand: string;
	rating: number | null;
	categories: string;
	description: string | null;
	about: string;
	details: string;
	reviews: string;
}

function formatItem(item: ItemRow): string {
	const lines = [`**Item ${item.item_id}: ${item.name}**`, `Brand: ${item.brand}`];

	if (item.rating != null) lines.push(`Rating: ${item.rating}/5`);

	try {
		const categories: string[] = JSON.parse(item.categories);
		lines.push(`Category: ${categories.slice(-2).join(" > ")}`);
	} catch {
		// skip
	}

	if (item.description) lines.push(`Description: ${item.description}`);

	try {
		const about: string[] = JSON.parse(item.about);
		if (about.length) lines.push(`Features:\n${about.map((a) => `  - ${a}`).join("\n")}`);
	} catch {
		// skip
	}

	try {
		const details: Record<string, string> = JSON.parse(item.details);
		const detailLines = Object.entries(details).map(([k, v]) => `  - ${k}: ${v}`);
		if (detailLines.length) lines.push(`Details:\n${detailLines.join("\n")}`);
	} catch {
		// skip
	}

	if (item.reviews) lines.push(`Reviews: ${item.reviews}`);

	return lines.join("\n");
}

const compareItemsParams = Type.Object({
	item_a_id: Type.Number({ description: "First item ID" }),
	item_b_id: Type.Number({ description: "Second item ID" }),
});

export const compareItemsTool: ToolDefinition<typeof compareItemsParams> = {
	name: "compare_items",
	label: "Compare Items",
	description: "Structured comparison between two catalogue items, showing all attributes side by side.",
	parameters: compareItemsParams,
	async execute(_toolCallId, params) {
		const db = getDb();

		const itemA = db.prepare("SELECT * FROM items WHERE item_id = ?").get(params.item_a_id) as ItemRow | undefined;
		const itemB = db.prepare("SELECT * FROM items WHERE item_id = ?").get(params.item_b_id) as ItemRow | undefined;

		if (!itemA && !itemB) {
			return {
				content: [{ type: "text" as const, text: `Neither Item ${params.item_a_id} nor Item ${params.item_b_id} found.` }],
				details: {},
			};
		}
		if (!itemA) {
			return {
				content: [{ type: "text" as const, text: `Item ${params.item_a_id} not found.\n\n${formatItem(itemB!)}` }],
				details: {},
			};
		}
		if (!itemB) {
			return {
				content: [{ type: "text" as const, text: `Item ${params.item_b_id} not found.\n\n${formatItem(itemA)}` }],
				details: {},
			};
		}

		const text = `## Comparison: Item ${itemA.item_id} vs Item ${itemB.item_id}\n\n### Item A\n${formatItem(itemA)}\n\n---\n\n### Item B\n${formatItem(itemB)}`;

		return { content: [{ type: "text" as const, text }], details: {} };
	},
};
