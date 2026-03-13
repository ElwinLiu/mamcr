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

/** Run a headless sub-agent session and collect its text response */
async function runSubAgent(
	systemPrompt: string,
	userPrompt: string,
	tools: typeof preferenceTools,
): Promise<string> {
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

/** Cold start: load taste profile from DB, produce summary text */
export async function coldStart(userId: string, excludeConvId: number): Promise<string> {
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
): Promise<string> {
	const systemPrompt = buildMonitorPrompt(userId, convId, seekerUtterance, agentResponse, existingPrefs);
	return runSubAgent(
		systemPrompt,
		"Analyze the exchange above. Extract and persist any new preference signals, then output the updated summary.",
		preferenceTools,
	);
}
