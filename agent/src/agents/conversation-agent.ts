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

## Dialogue Intent Tags
Each utterance is annotated with intent tags in brackets. Key:

Seeker tags: IQ (Initial Query), CON (Continue), PCT (Provide Context), PEP (Explicit Preference), PIP (Implicit Preference), RP (Refine Preference), ANS (Answer), ACK (Acknowledgement), INT (Interest), ACT (Accept), RJT (Reject), NR (Neutral Response), IF (Inquire Factual), IA (Inquire Opinion), CF (Critique Feature), CC (Critique Compare), EXP (Explain), AC (Ask Clarification)

Assistant tags: RTI (Request Task Initiation), RP (Request Preferences), RC (Request Context), CQ (Clarify Question), A (Ask Opinion), EF (Ensure Fulfillment), IP (Inform Progress), ACK (Acknowledgement), ANS (Answer), RS (Recommend Show), RC (Recommend Combine), EP (Explain Preference), EAI (Explain Additional Info), PCM (Comparison), PER (Persuasion), PEX (Prior Experience), PCN (Context Opinion)

## Guidelines
- Observe each exchange carefully for preference signals, item mentions, and critiques
- Use tools proactively to gather relevant context about mentioned items
- Use recall_history when past context would help understand the user's preferences
- After observing all exchanges, you will be asked to predict ratings
- Do NOT generate conversational responses — you are an observer, not a participant
- Keep your analysis notes brief and focused`;

	return { prompt, scenario: scenarioText, itemList };
}

/** Format intent tags from JSON array, e.g. [["PCT"],["IQ"]] → "[PCT] [IQ]" */
function formatTags(tagsJson: string): string {
	try {
		const parsed = JSON.parse(tagsJson) as string[][];
		return parsed.map((group) => `[${group.join(",")}]`).join(" ");
	} catch {
		return "";
	}
}

/** Build an observation prompt for a single exchange */
export function buildObservePrompt(turn: number, seekerContent: string, assistantContent: string, seekerTags?: string, assistantTags?: string): string {
	const sTags = seekerTags ? " " + formatTags(seekerTags) : "";
	const aTags = assistantTags ? " " + formatTags(assistantTags) : "";

	return `## Exchange — Turn ${turn}

**Seeker:** "${seekerContent}" ${sTags}

**Assistant:** "${assistantContent}" ${aTags}

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

Criteria: Rate the items based on how likely you think the Seeker is to purchase them, given the conversation and scenario that just concluded.

Items to rate:
${itemList}

Output your predictions as a JSON object mapping item_id to rating, like:
{"1": 3, "2": 5, "3": 1, ...}

Output ONLY the JSON object, nothing else.`;
}
