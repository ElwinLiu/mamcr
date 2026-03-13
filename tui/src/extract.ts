/**
 * Taste Extraction Pipeline: Pre-experiment step.
 *
 * For each conversation, an LLM reads the full transcript and:
 * 1. Extracts structured preference signals → user_preferences table
 * 2. Generates a conversation summary → conversations.summary column
 *
 * Run with: npm run extract
 */
import {
	createAgentSession,
	SessionManager,
	DefaultResourceLoader,
	type AgentSessionEvent,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { getDb } from "./db/schema.js";
import { updatePreferenceTool } from "./tools/update-preference.js";

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
}

interface ScenarioRow {
	body: string;
}

const EXTRACT_SYSTEM_PROMPT = `You are a preference extraction agent. Your job is to analyze a conversation transcript
and extract user preference signals.

For each preference signal you identify, call the update_preference tool with:
- user_id: the seeker's ID
- conv_id: the conversation ID
- description: a clear, natural language description of the preference

Types of signals to extract:
- Explicit preferences: "I like lightweight jackets", "I prefer earth tones"
- Implicit preferences: choosing one item over another reveals priorities
- Contextual needs: occasion requirements, weather needs, activity constraints
- Rejections: items dismissed and the reasons why
- Style patterns: recurring themes in what the user gravitates toward

After extracting all preferences, output a brief conversation summary (2-3 sentences)
capturing what happened and what the seeker decided.`;

async function extractFromConversation(convId: number): Promise<string> {
	const db = getDb();

	const conv = db.prepare("SELECT * FROM conversations WHERE conv_id = ?").get(convId) as ConvRow | undefined;
	if (!conv) throw new Error(`Conversation ${convId} not found`);

	const turns = db
		.prepare("SELECT turn, role, content FROM conversation_turns WHERE conv_id = ? ORDER BY turn")
		.all(convId) as TurnRow[];

	const scenario = db.prepare("SELECT body FROM scenarios WHERE scenario_id = ?").get(conv.scenario_id) as
		| ScenarioRow
		| undefined;

	const transcript = turns.map((t) => `**${t.role}** (turn ${t.turn}): ${t.content}`).join("\n\n");

	const userPrompt = `## Conversation ${convId}
User: ${conv.user_id} | Scenario: ${conv.scenario_id} | Catalogue: ${conv.catalogue}

### Scenario
${scenario?.body ?? "(Unknown)"}

### Transcript
${transcript}

Extract all preference signals from this conversation using the update_preference tool.
Then output a brief summary of the conversation.`;

	const loader = new DefaultResourceLoader({
		systemPromptOverride: () => EXTRACT_SYSTEM_PROMPT,
	});
	await loader.reload();

	const model = getModel("google", "gemini-3-flash-preview");

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "off",
		tools: [],
		customTools: [updatePreferenceTool] as ToolDefinition<any>[],
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});

	return new Promise<string>((resolve) => {
		const textParts: string[] = [];

		session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "message_end" && "role" in event.message && event.message.role === "assistant") {
				const msg = event.message as any;
				for (const block of msg.content ?? []) {
					if (block.type === "text") {
						textParts.push(block.text);
					}
				}
			}
			if (event.type === "agent_end") {
				resolve(textParts.join("\n"));
				session.dispose();
			}
		});

		session.prompt(userPrompt);
	});
}

export async function extractAll(): Promise<void> {
	const db = getDb();

	const convs = db
		.prepare("SELECT conv_id, user_id, scenario_id, catalogue FROM conversations ORDER BY conv_id")
		.all() as ConvRow[];

	console.log(`Extracting preferences from ${convs.length} conversations...`);

	for (const conv of convs) {
		// Skip if already has preferences extracted
		const existing = db
			.prepare("SELECT COUNT(*) as cnt FROM user_preferences WHERE source_conv_id = ?")
			.get(conv.conv_id) as { cnt: number };

		if (existing.cnt > 0) {
			console.log(`Conv ${conv.conv_id}: already extracted (${existing.cnt} prefs), skipping`);
			continue;
		}

		console.log(`\nExtracting conv ${conv.conv_id} (user=${conv.user_id}, scenario=${conv.scenario_id})...`);

		try {
			const summary = await extractFromConversation(conv.conv_id);

			// Store summary in conversations table
			db.prepare("UPDATE conversations SET summary = ? WHERE conv_id = ?").run(summary, conv.conv_id);

			const prefCount = db
				.prepare("SELECT COUNT(*) as cnt FROM user_preferences WHERE source_conv_id = ?")
				.get(conv.conv_id) as { cnt: number };
			console.log(`  → ${prefCount.cnt} preferences extracted, summary stored`);
		} catch (e) {
			console.error(`  Error extracting conv ${conv.conv_id}:`, e);
		}
	}

	// Final stats
	const totalPrefs = db.prepare("SELECT COUNT(*) as cnt FROM user_preferences").get() as { cnt: number };
	const totalSummaries = db.prepare("SELECT COUNT(*) as cnt FROM conversations WHERE summary IS NOT NULL").get() as {
		cnt: number;
	};
	console.log(`\nExtraction complete: ${totalPrefs.cnt} total preferences, ${totalSummaries.cnt} summaries`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	extractAll().catch(console.error);
}
