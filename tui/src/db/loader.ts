/**
 * Load VOGUE dataset from CSV/JSON files into SQLite.
 * Run with: npm run load-db
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { getDb, initSchema, DATASET_PATH } from "./schema.js";

interface ConversationJson {
	conversation_id: number;
	session_code: string;
	scenario: number;
	mentioned_items: number[];
	gt_items: number[];
	catalogue: string;
	conversation_content: Array<{
		turn: number;
		timestamp: string;
		content: {
			utterances: string[];
			role: string;
			tags: string[][];
		};
	}>;
}

interface ItemJson {
	id: number;
	catalogue: string;
	categories: string[];
	product_name: string;
	product_brand: string;
	product_rating: string;
	product_description: string | string[] | null;
	about_product: string[];
	product_detail: Record<string, string>;
	reviews: string;
}

interface ScenarioJson {
	Scenario: number;
	Body: string;
}

function loadScenarios(db: ReturnType<typeof getDb>): void {
	const raw = readFileSync(resolve(DATASET_PATH, "conversation_trials", "scenarios.json"), "utf-8");
	const scenarios: ScenarioJson[] = JSON.parse(raw);

	const stmt = db.prepare("INSERT OR REPLACE INTO scenarios (scenario_id, body) VALUES (?, ?)");
	for (const s of scenarios) {
		stmt.run(s.Scenario, s.Body);
	}
	console.log(`Loaded ${scenarios.length} scenarios`);
}

function loadItems(db: ReturnType<typeof getDb>): void {
	const metadataDir = resolve(DATASET_PATH, "metadata");
	const files = readdirSync(metadataDir).filter((f) => f.endsWith(".json"));

	const stmt = db.prepare(
		"INSERT OR REPLACE INTO items (item_id, catalogue, name, brand, rating, categories, description, about, details, reviews) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	);

	let count = 0;
	for (const file of files) {
		const raw = readFileSync(resolve(metadataDir, file), "utf-8");
		const item: ItemJson = JSON.parse(raw);
		// product_description can be null, a string, or an array — normalize to string
		const description =
			item.product_description == null
				? null
				: Array.isArray(item.product_description)
					? item.product_description.join(". ")
					: String(item.product_description);

		stmt.run(
			item.id,
			item.catalogue,
			item.product_name,
			item.product_brand,
			parseFloat(item.product_rating) || null,
			JSON.stringify(item.categories),
			description,
			JSON.stringify(item.about_product),
			JSON.stringify(item.product_detail),
			item.reviews,
		);
		count++;
	}
	console.log(`Loaded ${count} items`);
}

function loadProfiles(db: ReturnType<typeof getDb>): void {
	const raw = readFileSync(resolve(DATASET_PATH, "fashion_profiles", "profiles.csv"), "utf-8");
	const records = parse(raw, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

	const stmt = db.prepare(
		`INSERT OR REPLACE INTO users (user_id, style_preferences, style_vibes, purchase_frequency, monthly_spend, best_colors, clothing_feel,
		 comfort, style, practicality, trends, brand, self_expression, sustainability, price, color_importance)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);

	let count = 0;
	for (const r of records) {
		// Only load seekers (s1-s10), skip assistants (a1-a10)
		if (!r.participant_id.startsWith("s")) continue;
		stmt.run(
			r.participant_id,
			r.style_preferences,
			r.style_vibes,
			r.purchase_frequency,
			r.monthly_spend,
			r.best_colors,
			r.clothing_feel,
			parseInt(r.comfort) || null,
			parseInt(r.style) || null,
			parseInt(r.practicality) || null,
			parseInt(r.trends) || null,
			parseInt(r.brand) || null,
			parseInt(r.self_expression) || null,
			parseInt(r.sustainability) || null,
			parseInt(r.price) || null,
			parseInt(r.color_importance) || null,
		);
		count++;
	}
	console.log(`Loaded ${count} user profiles`);
}

function loadConversations(db: ReturnType<typeof getDb>): void {
	const transcriptDir = resolve(DATASET_PATH, "conversation_trials", "transcripts");
	const files = readdirSync(transcriptDir).filter((f) => f.endsWith(".json"));

	// First, build a mapping from conversation_id → seeker participant_id using ratings CSV
	const ratingsRaw = readFileSync(
		resolve(DATASET_PATH, "conversation_trials", "item_ratings", "seeker_ratings.csv"),
		"utf-8",
	);
	const ratingsRecords = parse(ratingsRaw, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

	const convToSeeker = new Map<number, string>();
	for (const r of ratingsRecords) {
		convToSeeker.set(parseInt(r.conversation_id), r.participant_id);
	}

	const convStmt = db.prepare(
		"INSERT OR REPLACE INTO conversations (conv_id, user_id, scenario_id, catalogue, mentioned_items, gt_items) VALUES (?, ?, ?, ?, ?, ?)",
	);
	const turnStmt = db.prepare(
		"INSERT OR REPLACE INTO conversation_turns (conv_id, turn, role, content, tags) VALUES (?, ?, ?, ?, ?)",
	);

	let convCount = 0;
	let turnCount = 0;
	for (const file of files) {
		const raw = readFileSync(resolve(transcriptDir, file), "utf-8");
		const conv: ConversationJson = JSON.parse(raw);
		const seekerId = convToSeeker.get(conv.conversation_id) ?? null;

		convStmt.run(
			conv.conversation_id,
			seekerId,
			conv.scenario,
			conv.catalogue,
			JSON.stringify(conv.mentioned_items),
			JSON.stringify(conv.gt_items),
		);
		convCount++;

		for (const turn of conv.conversation_content) {
			// Join multiple utterances with newlines
			const content = turn.content.utterances.join("\n");
			const tags = JSON.stringify(turn.content.tags);
			turnStmt.run(conv.conversation_id, turn.turn, turn.content.role, content, tags);
			turnCount++;
		}
	}
	console.log(`Loaded ${convCount} conversations, ${turnCount} turns`);
}

function loadRatings(db: ReturnType<typeof getDb>): void {
	const raw = readFileSync(
		resolve(DATASET_PATH, "conversation_trials", "item_ratings", "seeker_ratings.csv"),
		"utf-8",
	);
	const records = parse(raw, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

	const stmt = db.prepare(
		"INSERT OR REPLACE INTO ratings (user_id, conv_id, item_id, rating) VALUES (?, ?, ?, ?)",
	);

	let count = 0;
	for (const r of records) {
		const convId = parseInt(r.conversation_id);
		const userId = r.participant_id;

		// Items 1-36 have columns item_1 through item_36
		for (let i = 1; i <= 36; i++) {
			const rating = parseInt(r[`item_${i}`]);
			if (rating !== -1) {
				stmt.run(userId, convId, i, rating);
				count++;
			}
		}
	}
	console.log(`Loaded ${count} ratings`);
}

export function loadAll(): void {
	const db = getDb();
	initSchema(db);

	db.exec("BEGIN TRANSACTION");
	try {
		loadScenarios(db);
		loadItems(db);
		loadProfiles(db);
		loadConversations(db);
		loadRatings(db);
		db.exec("COMMIT");
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	}

	console.log("\nDatabase loaded successfully at:", db.name);
}

// Run directly: tsx src/db/loader.ts
if (import.meta.url === `file://${process.argv[1]}`) {
	loadAll();
}
