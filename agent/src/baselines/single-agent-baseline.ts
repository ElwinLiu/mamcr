/**
 * Single-Agent Baseline: Replicates the VOGUE paper's monolithic MLLM approach
 * using Gemini 3.0 Flash Preview (same model as MAMCR).
 *
 * Matches the paper exactly:
 * - Paper's system prompt (expert sales associate)
 * - Full item catalogue with metadata + images (multimodal)
 * - Tagged conversation transcript (with intent tags)
 * - Single-shot rating prediction
 * - No taste profile, no tools, no multi-agent
 */
import {
	createAgentSession,
	SessionManager,
	DefaultResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, PROJECT_ROOT } from "../db/schema.js";
import { runPromptToCompletion } from "../session-utils.js";

interface ConvRow {
	conv_id: number;
	user_id: string;
	scenario_id: number;
	catalogue: string;
}

interface TurnRow {
	turn: number;
	role: string;
	content: string;
	tags: string;
}

interface ItemRow {
	item_id: number;
	name: string;
	brand: string;
	rating: number;
	categories: string;
	description: string;
	about: string;
	details: string;
	reviews: string;
}

interface ScenarioRow {
	body: string;
}

const RESULTS_DIR = resolve(PROJECT_ROOT, "results_single_agent");
const METADATA_DIR = resolve(PROJECT_ROOT, "dataset", "data", "metadata");

/** Format intent tags from JSON array, e.g. [["PCT"],["IQ"]] → "[PCT] [IQ]" */
function formatTags(tagsJson: string): string {
	try {
		const parsed = JSON.parse(tagsJson) as string[][];
		return parsed.map((group) => `[${group.join(",")}]`).join(" ");
	} catch {
		return "";
	}
}

/** Load item image as base64 */
function loadItemImage(itemId: number): { data: string; mimeType: string } | null {
	const imgPath = resolve(METADATA_DIR, `item_${itemId}.png`);
	try {
		const buf = readFileSync(imgPath);
		return { data: buf.toString("base64"), mimeType: "image/png" };
	} catch {
		return null;
	}
}

/**
 * Build system prompt matching the VOGUE paper's exact prompt (page 7).
 * Scenario, item metadata, and tagged transcript are appended as context.
 */
function buildSystemPrompt(
	scenario: string,
	transcript: string,
	itemsBlock: string,
): string {
	// Paper's exact prompt (page 7, Section 4.3)
	return `You are an expert sales associate and fashion expert, with deep experience in apparel, styling, sales, and customer relations, reviewing a recorded conversation between an assistant and a seeker. The assistant provides shopping advice and help to the seeker, who is attempting to make a clothes purchase. You must rate each of the 12 items on a 1-5 scale (inclusive).

---
Scenario:
${scenario}

Conversation transcript:
${transcript}

Item catalogue and metadata:
${itemsBlock}`;
}

function buildRatingPrompt(items: ItemRow[]): string {
	const itemList = items.map((i) => `  - Item ${i.item_id}: ${i.name}`).join("\n");

	return `Criteria: Rate the items based on how likely you think the Seeker is to purchase them, given the conversation and scenario that just concluded.

Rate each item on a 1-5 scale (inclusive).

Items to rate:
${itemList}

Output your predictions as a JSON object mapping item_id to rating, like:
{"1": 3, "2": 5, "3": 1, ...}

Output ONLY the JSON object, nothing else.`;
}

export async function runSingleAgentBaseline(convId: number): Promise<Record<string, number>> {
	const db = getDb();

	const conv = db.prepare(
		"SELECT conv_id, user_id, scenario_id, catalogue FROM conversations WHERE conv_id = ?",
	).get(convId) as ConvRow | undefined;
	if (!conv) throw new Error(`Conversation ${convId} not found`);

	const scenario = db.prepare("SELECT body FROM scenarios WHERE scenario_id = ?")
		.get(conv.scenario_id) as ScenarioRow | undefined;

	const turns = db.prepare(
		"SELECT turn, role, content, tags FROM conversation_turns WHERE conv_id = ? ORDER BY turn",
	).all(convId) as TurnRow[];

	const items = db.prepare(
		"SELECT item_id, name, brand, rating, categories, description, about, details, reviews FROM items WHERE catalogue = ?",
	).all(conv.catalogue) as ItemRow[];

	// Format tagged transcript (matching paper's format with intent tags)
	const transcript = turns
		.map((t) => {
			const tags = formatTags(t.tags);
			return `Turn ${t.turn} (${t.role}): "${t.content}" ${tags}`;
		})
		.join("\n");

	// Format items with full metadata
	const itemsBlock = items
		.map((item) => {
			let cats: string[];
			try { cats = JSON.parse(item.categories); } catch { cats = []; }
			let reviews: string[];
			try { reviews = JSON.parse(item.reviews); } catch { reviews = []; }

			return `### Item ${item.item_id}: ${item.name}
- Brand: ${item.brand}
- Rating: ${item.rating}
- Categories: ${cats.join(" > ")}
- Description: ${item.description}
- About: ${item.about || "N/A"}
- Details: ${item.details || "N/A"}
- Reviews: ${reviews.length > 0 ? reviews.slice(0, 3).join(" | ") : "N/A"}`;
		})
		.join("\n\n");

	// Load item images for multimodal input
	const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
	for (const item of items) {
		const img = loadItemImage(item.item_id);
		if (img) {
			images.push({ type: "image", data: img.data, mimeType: img.mimeType });
		}
	}

	const systemPrompt = buildSystemPrompt(
		scenario?.body ?? "(Unknown scenario)",
		transcript,
		itemsBlock,
	);

	// Create a minimal agent session — no tools, single shot
	const loader = new DefaultResourceLoader({
		systemPromptOverride: () => systemPrompt,
	});
	await loader.reload();

	const model = getModel("google", "gemini-3-flash-preview");

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "off",
		tools: [],
		customTools: [],
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});

	const ratingPrompt = buildRatingPrompt(items);
	const { text: ratingText } = await runPromptToCompletion(session, ratingPrompt, { images });

	session.dispose();

	let predictions: Record<string, number> = {};
	try {
		const jsonMatch = ratingText.match(/\{[\s\S]*\}/);
		predictions = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
	} catch {
		console.error(`Conv ${convId}: Could not parse response: ${ratingText}`);
	}

	// Save results
	const convDir = resolve(RESULTS_DIR, `conv_${convId}`);
	mkdirSync(convDir, { recursive: true });
	writeFileSync(resolve(convDir, "predictions.json"), JSON.stringify(predictions, null, 2));

	return predictions;
}
