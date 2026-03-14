/**
 * Preference Agent: Tracks user preferences via cold start + live monitoring.
 *
 * - Cold start: programmatically loads taste profile from DB (no LLM needed)
 * - Live monitoring: extracts preference signals after each exchange
 * - Produces a preference summary text block for injection into Conversation Agent context
 */
import {
	createAgentSession,
	SessionManager,
	DefaultResourceLoader,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { preferenceTools } from "../tools/index.js";
import { loadTasteProfile } from "../tools/load-taste-profile.js";
import { runPromptToCompletion, type PromptResult } from "../session-utils.js";

export type SubAgentResult = PromptResult;

export interface Exchange {
	turn: number;
	seeker: string;
	assistant: string;
}

function formatConversationHistory(exchanges: Exchange[]): string {
	return exchanges
		.map((ex) => `**Turn ${ex.turn}**\n**Seeker:** ${ex.seeker}\n**Assistant:** ${ex.assistant}`)
		.join("\n\n");
}

function buildMonitorPrompt(
	userId: string,
	convId: number,
	exchanges: Exchange[],
	previousAnalysis: string,
): string {
	return `You are a preference monitoring agent. Analyze the conversation so far and extract preference signals from the latest exchange.

## User: ${userId} | Conversation: ${convId}

## Conversation History
${formatConversationHistory(exchanges)}

## Previous Preference Analysis
${previousAnalysis}

## Instructions
1. Review the full conversation above, focusing on the latest exchange (Turn ${exchanges[exchanges.length - 1].turn}).
2. Identify **new** preference signals not already captured in the previous analysis:
   - Explicit preferences (stated likes/dislikes)
   - Implicit preferences (reactions, follow-up questions suggesting interest)
   - Critiques or rejections (items dismissed and why)
   - Contextual requirements (occasion, weather, activity needs)
   - Evolving or contradicting preferences (e.g., earlier interest now reversed)
3. Output only **additional** findings from this turn. Do not repeat what is already in the previous analysis.
   If there are no new signals, say so briefly.`;
}

/** Run a headless sub-agent session and collect its text response + tool calls */
async function runSubAgent(
	systemPrompt: string,
	userPrompt: string,
	tools: typeof preferenceTools,
): Promise<SubAgentResult> {
	const loader = new DefaultResourceLoader({
		systemPromptOverride: () => systemPrompt,
	});
	await loader.reload();

	const model = getModel("google", "gemini-3-flash-preview");

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "off",
		tools: [],
		customTools: tools,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});

	try {
		return await runPromptToCompletion(session, userPrompt);
	} finally {
		session.dispose();
	}
}

/** Cold start: load taste profile directly from DB (no LLM needed).
 *  Exclusion is handled by the simulation scope — no conv ID needed here. */
export function coldStart(userId: string): SubAgentResult {
	const text = loadTasteProfile(userId);
	return {
		text,
		toolCalls: [{ tool: "load_taste_profile", args: { user_id: userId }, result: text }],
	};
}

/** Live monitoring: analyze conversation history, extract new signals from the latest exchange */
export async function monitorExchange(
	userId: string,
	convId: number,
	exchanges: Exchange[],
	previousAnalysis: string,
): Promise<SubAgentResult> {
	const systemPrompt = buildMonitorPrompt(userId, convId, exchanges, previousAnalysis);
	return runSubAgent(
		systemPrompt,
		"Analyze the latest exchange in context of the full conversation. Output only additional preference signals not already in the previous analysis.",
		preferenceTools,
	);
}
