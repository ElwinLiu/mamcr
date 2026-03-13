import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { getDb } from "../db/schema.js";
import { embedText } from "../db/embed.js";

interface ItemRow {
	item_id: number;
	name: string;
	brand: string;
	categories: string;
}

interface EmbeddingRow {
	item_id: number;
	embedding: Buffer;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const catalogueSearchParams = Type.Object({
	query: Type.String({ description: "Natural language description of desired attributes" }),
	catalogue: Type.String({ description: '"a" (outerwear), "b" (layering), or "c" (shoes)' }),
	top_k: Type.Optional(Type.Number({ description: "Number of results (default 4)" })),
});

export const catalogueSearchTool: ToolDefinition<typeof catalogueSearchParams> = {
	name: "catalogue_search",
	label: "Catalogue Search",
	description:
		"Semantic search over items in a catalogue using text embeddings. Returns items ranked by relevance to the query.",
	parameters: catalogueSearchParams,
	async execute(_toolCallId, params) {
		const db = getDb();
		const topK = params.top_k ?? 4;
		const apiKey = process.env.GEMINI_API_KEY;
		if (!apiKey) {
			return {
				content: [{ type: "text" as const, text: "Error: GEMINI_API_KEY not set. Cannot compute query embedding." }],
				details: {},
			};
		}

		// Get query embedding via Gemini
		const queryEmbArr = await embedText(params.query, apiKey);
		const queryEmb = new Float32Array(queryEmbArr);

		// Get all items in catalogue with their embeddings
		const items = db
			.prepare("SELECT item_id, name, brand, categories FROM items WHERE catalogue = ?")
			.all(params.catalogue) as ItemRow[];
		const embeddings = db
			.prepare(
				`SELECT e.item_id, e.embedding FROM item_embeddings e
				 JOIN items i ON e.item_id = i.item_id WHERE i.catalogue = ?`,
			)
			.all(params.catalogue) as EmbeddingRow[];

		const embMap = new Map<number, Float32Array>();
		for (const e of embeddings) {
			embMap.set(e.item_id, new Float32Array(e.embedding.buffer, e.embedding.byteOffset, e.embedding.byteLength / 4));
		}

		// Score and rank
		const scored = items
			.map((item) => {
				const emb = embMap.get(item.item_id);
				const score = emb ? cosineSimilarity(queryEmb, emb) : 0;
				return { ...item, score };
			})
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);

		// Format results
		const lines = scored.map((item, i) => {
			let categories: string[];
			try {
				categories = JSON.parse(item.categories);
			} catch {
				categories = [];
			}
			const catStr = categories.slice(-2).join(" > ");
			return `${i + 1}. Item ${item.item_id}: ${item.name}\n   Brand: ${item.brand} | Category: ${catStr}\n   Relevance: ${(item.score * 100).toFixed(1)}%`;
		});

		const text = `## Catalogue Search: "${params.query}" (catalogue ${params.catalogue})\n\n${lines.join("\n\n")}`;

		return { content: [{ type: "text" as const, text }], details: {} };
	},
};
