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
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { getConversationTool } from "../tools/index.js";
import { getDb } from "../db/schema.js";
import { scopedTable } from "../db/scope.js";
import { runPromptToCompletion } from "../session-utils.js";
import type { SubAgentResult } from "./preference-agent.js";

const HISTORY_SYSTEM_PROMPT = `You are a history research agent. Your job is to search a user's past conversations
and provide relevant historical context based on a query.

You have access to:
- get_conversation: Retrieve full transcript, metadata, and extracted preferences for a past conversation

The available conversations are listed in the prompt. Use get_conversation to drill into
the most relevant ones, then synthesize a concise context summary focused on the query.

Be selective — only return information directly relevant to the query.`;

interface ConvMetaRow {
	conv_id: number;
	scenario_id: number;
	catalogue: string;
}

/** Run the history agent and return its response + tool calls.
 *  Exclusion is handled by the simulation scope — queries automatically
 *  use v_conversations which excludes the test conversation. */
async function runHistorySearch(
	userId: string,
	query: string,
): Promise<SubAgentResult> {
	// Pre-fetch conversation list from scoped view
	const db = getDb();
	const table = scopedTable("conversations");
	const convs = db
		.prepare(`SELECT conv_id, scenario_id, catalogue FROM ${table} WHERE user_id = ?`)
		.all(userId) as ConvMetaRow[];

	const convList = convs
		.map((c) => `  - Conv ${c.conv_id}: scenario ${c.scenario_id}, catalogue ${c.catalogue}`)
		.join("\n");

	const userPrompt = `## History Query
User: ${userId}
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
		customTools: [getConversationTool as ToolDefinition<any>],
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});

	try {
		return await runPromptToCompletion(session, userPrompt);
	} finally {
		session.dispose();
	}
}

const recallHistoryParams = Type.Object({
	query: Type.String({
		description:
			'What historical context to search for, e.g. "Has this user bought outerwear before?" or "What items did they reject and why?"',
	}),
	user_id: Type.String({ description: "The seeker's ID" }),
});

/** Create a recall_history tool with an optional callback for sub-agent tool calls */
export function createRecallHistoryTool(
	onSubAgentToolCall?: (tc: { tool: string; args: any; result: string }) => void,
): ToolDefinition<typeof recallHistoryParams> {
	return {
		name: "recall_history",
		label: "Recall History",
		description: `Search this user's past conversations for relevant historical context.
Use this when you want to know what the user liked/disliked in previous interactions,
their behavior patterns, or any relevant past context that could inform current recommendations.`,
		parameters: recallHistoryParams,
		async execute(_toolCallId, params) {
			const { text, toolCalls } = await runHistorySearch(params.user_id, params.query);
			if (onSubAgentToolCall) {
				for (const tc of toolCalls) onSubAgentToolCall(tc);
			}
			return { content: [{ type: "text" as const, text }], details: {} };
		},
	};
}

/** Default instance (for CLI / non-instrumented usage) */
export const recallHistoryTool = createRecallHistoryTool();
