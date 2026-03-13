/**
 * Conversation Agent: Observes replayed human conversations and predicts ratings.
 *
 * Receives injected context from the Preference Agent and has access to
 * catalogue_search, compare_items, sql_query, and recall_history tools.
 *
 * Does NOT generate assistant responses — both Seeker and Assistant turns are
 * replayed from the dataset. The agent observes, gathers context via tools,
 * and predicts ratings at the end.
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

export interface SystemPromptComponents {
	prompt: string;
	scenario: string;
	itemList: string;
}

/** Build the system prompt for the Conversation Agent (observer mode) */
export function buildSystemPrompt(
	convId: number,
	userId: string,
	scenarioId: number,
	catalogue: string,
	tasteProfile: string,
): SystemPromptComponents {
	const db = getDb();

	const scenario = db.prepare("SELECT body FROM scenarios WHERE scenario_id = ?").get(scenarioId) as
		| ScenarioRow
		| undefined;

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

	const scenarioText = scenario?.body ?? "(Unknown scenario)";

	const prompt = `You are an expert fashion recommendation analyst observing a conversation between a Seeker (customer) and an Assistant (human stylist).

Your task is to observe the conversation exchange by exchange, gather context using your tools, and at the end predict how the Seeker would rate each item on a 1-5 scale.

## Context
- Conversation ID: ${convId}
- User: ${userId}
- Scenario: ${scenarioId}
- Catalogue: ${catalogue}

## Scenario
${scenarioText}

## Available Items (Catalogue ${catalogue})
${itemList}

Note: You only see basic item info above. Use the sql_query tool to get full details (description, features, reviews) for specific items when needed. Use catalogue_search for semantic retrieval.

## Tools Available
- **catalogue_search**: Find items matching a natural language query (semantic search)
- **compare_items**: Structured attribute comparison between two items
- **sql_query**: Query item details, user profile, etc. on demand
- **recall_history**: Search this user's past conversations for relevant context

## User Taste Profile
${tasteProfile}

## Guidelines
- Observe each exchange carefully for preference signals, item mentions, and critiques
- Use tools proactively to gather relevant context about mentioned items
- Use recall_history when past context would help understand the user's preferences
- After observing all exchanges, you will be asked to predict ratings
- Do NOT generate conversational responses — you are an observer, not a participant
- Keep your analysis notes brief and focused`;

	return { prompt, scenario: scenarioText, itemList };
}

/** Build an observation prompt for a single exchange */
export function buildObservePrompt(turn: number, seekerContent: string, assistantContent: string): string {
	return `## Exchange — Turn ${turn}

**Seeker:** ${seekerContent}

**Assistant:** ${assistantContent}

Analyze this exchange. Note preference signals, item reactions, and requirements. Use tools to gather context about mentioned items if needed. Keep your notes brief.`;
}

/** Build the rating prediction prompt (sent after all exchanges observed) */
export function buildRatingPrompt(catalogue: string): string {
	const db = getDb();
	const items = db.prepare("SELECT item_id, name FROM items WHERE catalogue = ?").all(catalogue) as Array<{
		item_id: number;
		name: string;
	}>;

	const itemList = items.map((i) => `  - Item ${i.item_id}: ${i.name}`).join("\n");

	return `Now that you have observed the full conversation, predict how likely the seeker would be to purchase each item.

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
