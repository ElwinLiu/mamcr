/**
 * Conversation Agent: Plays the Assistant role in conversations.
 *
 * Receives injected context from the Preference Agent and has access to
 * catalogue_search, compare_items, sql_query, and recall_history tools.
 */
import { getDb } from "../db/schema.js";

interface ItemRow {
	item_id: number;
	name: string;
	categories: string;
}

interface ScenarioRow {
	body: string;
}

/** Build the system prompt for the Conversation Agent */
export function buildSystemPrompt(
	convId: number,
	userId: string,
	scenarioId: number,
	catalogue: string,
	tasteProfile: string,
): string {
	const db = getDb();

	// Get scenario
	const scenario = db.prepare("SELECT body FROM scenarios WHERE scenario_id = ?").get(scenarioId) as
		| ScenarioRow
		| undefined;

	// Get basic item metadata (names + categories only — progressive disclosure)
	const items = db
		.prepare("SELECT item_id, name, categories FROM items WHERE catalogue = ?")
		.all(catalogue) as ItemRow[];

	const itemList = items
		.map((item) => {
			let cats: string[];
			try {
				cats = JSON.parse(item.categories);
			} catch {
				cats = [];
			}
			return `  - Item ${item.item_id}: ${item.name} (${cats.slice(-2).join(" > ")})`;
		})
		.join("\n");

	return `You are an expert fashion shopping assistant conducting a conversation with a customer (the Seeker).
Your goal is to understand the seeker's needs, recommend items from the catalogue, handle critiques,
and help them find the best items for their situation.

## Context
- Conversation ID: ${convId}
- User: ${userId}
- Scenario: ${scenarioId}
- Catalogue: ${catalogue}

## Scenario
${scenario?.body ?? "(Unknown scenario)"}

## Available Items (Catalogue ${catalogue})
${itemList}

Note: You only see basic item info above. Use the sql_query tool to get full details (description, features,
reviews) for specific items when needed. Use catalogue_search for semantic retrieval.

## Tools Available
- **catalogue_search**: Find items matching a natural language query (semantic search)
- **compare_items**: Structured attribute comparison between two items
- **sql_query**: Query item details, user profile, etc. on demand
- **recall_history**: Search this user's past conversations for relevant context

## User Taste Profile
${tasteProfile}

## Guidelines
- Follow the natural 5-stage conversation flow: Preference Elicitation → Recommendation → Critique → Refinement → Final Agreement
- Ground your recommendations in actual item data (use tools, don't hallucinate)
- When the seeker critiques an item, use compare_items to suggest alternatives
- Use recall_history when past context would help (same catalogue, cross-catalogue insights)
- Be conversational and helpful, not robotic
- Refer to items as "Item X" to match the dataset format`;
}

/** Build the rating prediction prompt (sent after final conversation turn) */
export function buildRatingPrompt(catalogue: string): string {
	const db = getDb();
	const items = db.prepare("SELECT item_id, name FROM items WHERE catalogue = ?").all(catalogue) as Array<{
		item_id: number;
		name: string;
	}>;

	const itemList = items.map((i) => `  - Item ${i.item_id}: ${i.name}`).join("\n");

	return `Now that the conversation is complete, predict how likely the seeker would be to purchase each item.

Rate each item on a 1-5 scale:
  1 = Not at all likely to purchase
  2 = Unlikely to purchase
  3 = Neutral
  4 = Likely to purchase
  5 = Very likely to purchase

Consider:
- Items explicitly discussed positively should rate higher
- Items that match the seeker's stated preferences and requirements
- Items rejected or criticized should rate lower
- Items not discussed: infer from the seeker's taste profile and conversation context
- Be calibrated: most items should rate low (1-2) since seekers are selective

Items to rate:
${itemList}

Output your predictions as a JSON object mapping item_id to rating, like:
{"1": 3, "2": 5, "3": 1, ...}

Output ONLY the JSON object, nothing else.`;
}
