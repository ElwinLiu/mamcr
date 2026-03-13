/**
 * Preference Agent: Tracks user preferences via cold start + live monitoring.
 *
 * - Cold start: loads taste profile from prior conversations (excluding test conv)
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

export interface SubAgentResult {
	text: string;
	toolCalls: Array<{ tool: string; args: any; result: string }>;
}

const COLD_START_PROMPT = `You are a preference analysis agent. Your job is to load and organize a user's taste profile.

Call the load_taste_profile tool with the provided user_id and exclude_conv_id to get their profile and prior preferences.
Then output a clean, organized summary of their taste profile that can be used by a conversation agent.`;

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
2. For each NEW signal not already captured, call update_preference with a clear description.
3. After recording preferences, output an updated preference summary combining existing and new signals.

Only record genuinely new information. Do not duplicate existing preferences.`;
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

		session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "tool_execution_end") {
				const e = event as any;
				toolCalls.push({
					tool: e.toolName,
					args: e.input ?? e.arguments ?? {},
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

/** Cold start: load taste profile from DB, produce summary text */
export async function coldStart(userId: string, excludeConvId: number): Promise<SubAgentResult> {
	const prompt = `Load the taste profile for user "${userId}", excluding conversation ${excludeConvId}. Then provide a clean summary.`;
	return runSubAgent(COLD_START_PROMPT, prompt, preferenceTools);
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
