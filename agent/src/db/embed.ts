/**
 * Compute text embeddings for all items and store in SQLite.
 * Run with: npm run embed
 * Requires GEMINI_API_KEY environment variable.
 */
import { getDb } from "./schema.js";

const EMBEDDING_MODEL = "gemini-embedding-2-preview";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface ItemRow {
	item_id: number;
	name: string;
	description: string | null;
	about: string;
	details: string;
	reviews: string;
}

function getApiKey(): string {
	const key = process.env.GEMINI_API_KEY;
	if (!key) throw new Error("GEMINI_API_KEY environment variable is required");
	return key;
}

function buildEmbeddingText(item: ItemRow): string {
	const parts = [item.name];
	if (item.description) parts.push(item.description);

	try {
		const about = JSON.parse(item.about) as string[];
		if (about.length) parts.push(about.join(". "));
	} catch {
		// skip
	}

	try {
		const details = JSON.parse(item.details) as Record<string, string>;
		const detailStr = Object.entries(details)
			.map(([k, v]) => `${k}: ${v}`)
			.join(". ");
		if (detailStr) parts.push(detailStr);
	} catch {
		// skip
	}

	if (item.reviews) parts.push(item.reviews);
	return parts.join("\n");
}

async function embedText(text: string, apiKey: string): Promise<number[]> {
	const url = `${GEMINI_BASE_URL}/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: `models/${EMBEDDING_MODEL}`,
			content: { parts: [{ text }] },
		}),
	});
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Gemini embedding error: ${res.status} ${err}`);
	}
	const data = (await res.json()) as { embedding: { values: number[] } };
	return data.embedding.values;
}

async function embedAllItems(): Promise<void> {
	const apiKey = getApiKey();
	const db = getDb();

	const items = db.prepare("SELECT item_id, name, description, about, details, reviews FROM items").all() as ItemRow[];
	console.log(`Computing embeddings for ${items.length} items using Gemini ${EMBEDDING_MODEL}...`);

	const stmt = db.prepare("INSERT OR REPLACE INTO item_embeddings (item_id, embedding) VALUES (?, ?)");
	db.exec("BEGIN TRANSACTION");
	try {
		for (let i = 0; i < items.length; i++) {
			const text = buildEmbeddingText(items[i]);
			const embedding = await embedText(text, apiKey);
			const buffer = Buffer.from(new Float32Array(embedding).buffer);
			stmt.run(items[i].item_id, buffer);
			if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${items.length}`);
		}
		db.exec("COMMIT");
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	}

	// Verify dimensions
	const sample = db.prepare("SELECT embedding FROM item_embeddings LIMIT 1").get() as { embedding: Buffer } | undefined;
	const dims = sample ? sample.embedding.byteLength / 4 : 0;
	console.log(`Stored ${items.length} embeddings (${dims} dimensions)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	embedAllItems().catch(console.error);
}

export { buildEmbeddingText, embedText, EMBEDDING_MODEL };
