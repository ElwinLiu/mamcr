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
	type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { preferenceTools } from "../tools/index.js";
import { loadTasteProfile } from "../tools/load-taste-profile.js";

export interface SubAgentResult {
	text: string;
	toolCalls: Array<{ tool: string; args: any; result: string }>;
}

function buildMonitorPrompt(
	userId: string,
	convId: number,
	seekerUtterance: string,
	agentResponse: string,
	existingPrefs: string,
): string {
	return `You are a preference monitoring agent. Analyze the following exchange and extract any new preference signals.

## User: ${userId} | Conversation: ${convId}

## Existing Preferences
${existingPrefs}

## Latest Exchange

**Seeker:** ${seekerUtterance}

**Assistant:** ${agentResponse}

## Instructions
1. Identify new preference signals from BOTH the seeker's utterance and the assistant's response:
   - Explicit preferences (stated likes/dislikes)
   - Implicit preferences (reactions, follow-up questions suggesting interest)
   - Critiques or rejections (items dismissed and why)
   - Contextual requirements (occasion, weather, activity needs)
2. Output an updated preference summary combining existing and new signals.

Only include genuinely new information. Do not duplicate existing preferences.`;
}

/** Extract readable text from a tool result (which may be an MCP-style object) */
function extractToolResult(result: any): string {
	if (typeof result === "string") return result;
	if (Array.isArray(result)) {
		return result
			.filter((b: any) => b.type === "text")
			.map((b: any) => b.text)
			.join("\n");
	}
	if (result?.content && Array.isArray(result.content)) {
		return result.content
			.filter((b: any) => b.type === "text")
			.map((b: any) => b.text)
			.join("\n");
	}
	try {
		return JSON.stringify(result, null, 2);
	} catch {
		return String(result);
	}
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

	return new Promise<SubAgentResult>((resolve) => {
		const textParts: string[] = [];
		const toolCalls: SubAgentResult["toolCalls"] = [];
		const pendingArgs = new Map<string, any>();

		session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "tool_execution_start") {
				const e = event as any;
				pendingArgs.set(e.toolCallId, e.args ?? {});
			}
			if (event.type === "tool_execution_end") {
				const e = event as any;
				const args = pendingArgs.get(e.toolCallId) ?? {};
				pendingArgs.delete(e.toolCallId);
				toolCalls.push({
					tool: e.toolName,
					args,
					result: extractToolResult(e.result),
				});
			}
			if (event.type === "message_end" && "role" in event.message && event.message.role === "assistant") {
				const msg = event.message as any;
				for (const block of msg.content ?? []) {
					if (block.type === "text") {
						textParts.push(block.text);
					}
				}
			}
			if (event.type === "agent_end") {
				resolve({ text: textParts.join("\n"), toolCalls });
				session.dispose();
			}
		});

		session.prompt(userPrompt);
	});
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

/** Live monitoring: analyze exchange, extract and persist new signals, return updated summary */
export async function monitorExchange(
	userId: string,
	convId: number,
	seekerUtterance: string,
	agentResponse: string,
	existingPrefs: string,
): Promise<SubAgentResult> {
	const systemPrompt = buildMonitorPrompt(userId, convId, seekerUtterance, agentResponse, existingPrefs);
	return runSubAgent(
		systemPrompt,
		"Analyze the exchange above. Extract and persist any new preference signals, then output the updated summary.",
		preferenceTools,
	);
}
