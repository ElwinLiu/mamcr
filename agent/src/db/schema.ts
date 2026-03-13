import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
export const DB_PATH = resolve(PROJECT_ROOT, "mamcr.db");
export const DATASET_PATH = resolve(PROJECT_ROOT, "dataset", "data");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (!db) {
		db = new Database(DB_PATH);
		db.pragma("journal_mode = WAL");
		db.pragma("foreign_keys = ON");
	}
	return db;
}

export function closeDb(): void {
	if (db) {
		db.close();
		db = null;
	}
}

export function initSchema(database: Database.Database): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS users (
			user_id TEXT PRIMARY KEY,
			style_preferences TEXT,
			style_vibes TEXT,
			purchase_frequency TEXT,
			monthly_spend TEXT,
			best_colors TEXT,
			clothing_feel TEXT,
			comfort INTEGER,
			style INTEGER,
			practicality INTEGER,
			trends INTEGER,
			brand INTEGER,
			self_expression INTEGER,
			sustainability INTEGER,
			price INTEGER,
			color_importance INTEGER
		);

		CREATE TABLE IF NOT EXISTS items (
			item_id INTEGER PRIMARY KEY,
			catalogue TEXT,
			name TEXT,
			brand TEXT,
			rating REAL,
			categories TEXT,
			description TEXT,
			about TEXT,
			details TEXT,
			reviews TEXT
		);

		CREATE TABLE IF NOT EXISTS scenarios (
			scenario_id INTEGER PRIMARY KEY,
			body TEXT
		);

		CREATE TABLE IF NOT EXISTS conversations (
			conv_id INTEGER PRIMARY KEY,
			user_id TEXT,
			scenario_id INTEGER,
			catalogue TEXT,
			mentioned_items TEXT,
			gt_items TEXT,
			summary TEXT,
			FOREIGN KEY (user_id) REFERENCES users(user_id),
			FOREIGN KEY (scenario_id) REFERENCES scenarios(scenario_id)
		);

		CREATE TABLE IF NOT EXISTS conversation_turns (
			conv_id INTEGER,
			turn INTEGER,
			role TEXT,
			content TEXT,
			tags TEXT,
			PRIMARY KEY (conv_id, turn, role)
		);

		CREATE TABLE IF NOT EXISTS user_preferences (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id TEXT,
			source_conv_id INTEGER,
			description TEXT,
			FOREIGN KEY (user_id) REFERENCES users(user_id),
			FOREIGN KEY (source_conv_id) REFERENCES conversations(conv_id)
		);

		CREATE TABLE IF NOT EXISTS ratings (
			user_id TEXT,
			conv_id INTEGER,
			item_id INTEGER,
			rating INTEGER,
			PRIMARY KEY (user_id, conv_id, item_id)
		);

		CREATE TABLE IF NOT EXISTS item_embeddings (
			item_id INTEGER PRIMARY KEY,
			embedding BLOB
		);
	`);
}
