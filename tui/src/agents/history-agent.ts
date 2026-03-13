/**
 * History Agent: Provides historical context on demand.
 *
 * Invoked as a tool (recall_history) from the Conversation Agent.
 * Searches user's past conversations for relevant context.
 */
import {
	createAgentSession,
	SessionManager,
	DefaultResourceLoader,
	type AgentSessionEvent,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { historyTools } from "../tools/index.js";
import { getDb } from "../db/schema.js";

const HISTORY_SYSTEM_PROMPT = `You are a history research agent. Your job is to search a user's past conversations
and provide relevant historical context based on a query.

You have access to:
- get_conversation: Retrieve full transcript and metadata for any conversation
- sql_query: Query the database for conversation metadata, user preferences, etc.

Strategy:
1. First query conversation metadata to find relevant past conversations
2. Drill into the most relevant ones using get_conversation
3. Synthesize a concise historical context summary focused on the query

Be selective — only return information directly relevant to the query.
Do NOT include information from the excluded conversation.`;

interface ConvMetaRow {
	conv_id: number;
	scenario_id: number;
	catalogue: string;
	summary: string | null;
}

/** Run the history agent and return its response */
async function runHistorySearch(
	userId: string,
	excludeConvId: number,
	query: string,
): Promise<string> {
	// Pre-fetch conversation list for context
	const db = getDb();
	const convs = db
		.prepare("SELECT conv_id, scenario_id, catalogue, summary FROM conversations WHERE user_id = ? AND conv_id != ?")
		.all(userId, excludeConvId) as ConvMetaRow[];

	const convList = convs
		.map((c) => `  - Conv ${c.conv_id}: scenario ${c.scenario_id}, catalogue ${c.catalogue}${c.summary ? ` — ${c.summary}` : ""}`)
		.join("\n");

	const userPrompt = `## History Query
User: ${userId} (exclude conversation ${excludeConvId})
Query: ${query}

## Available Conversations
${convList || "(No other conversations found)"}

Search the relevant conversations and provide a concise historical context summary.`;

	const loader = new DefaultResourceLoader({
		systemPromptOverride: () => HISTORY_SYSTEM_PROMPT,
	});
	await loader.reload();

	const model = getModel("google", "gemini-3-flash-preview");

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "off",
		tools: [],
		customTools: historyTools,
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

const recallHistoryParams = Type.Object({
	query: Type.String({
		description:
			'What historical context to search for, e.g. "Has this user bought outerwear before?" or "What items did they reject and why?"',
	}),
	user_id: Type.String({ description: "The seeker's ID" }),
	exclude_conv_id: Type.Number({ description: "Current conversation ID (to exclude from search)" }),
});

/** Tool definition that wraps the History Agent for use by the Conversation Agent */
export const recallHistoryTool: ToolDefinition<typeof recallHistoryParams> = {
	name: "recall_history",
	label: "Recall History",
	description: `Search this user's past conversations for relevant historical context.
Use this when you want to know what the user liked/disliked in previous interactions,
their behavior patterns, or any relevant past context that could inform current recommendations.`,
	parameters: recallHistoryParams,
	async execute(_toolCallId, params) {
		const result = await runHistorySearch(params.user_id, params.exclude_conv_id, params.query);
		return { content: [{ type: "text" as const, text: result }], details: {} };
	},
};
