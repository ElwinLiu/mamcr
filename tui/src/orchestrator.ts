/**
 * Orchestrator: Coordinates the 3 agents for a full conversation simulation.
 *
 * Flow:
 * 1. Cold start: Preference Agent loads taste profile
 * 2. Per turn: Replay seeker → Conversation Agent responds → Preference Agent monitors
 * 3. Post-conversation: Conversation Agent predicts ratings
 */
import {
	createAgentSession,
	SessionManager,
	DefaultResourceLoader,
	type AgentSessionEvent,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, PROJECT_ROOT } from "./db/schema.js";
import { conversationTools } from "./tools/index.js";
import { recallHistoryTool } from "./agents/history-agent.js";
import { coldStart, monitorExchange } from "./agents/preference-agent.js";
import { buildSystemPrompt, buildRatingPrompt } from "./agents/conversation-agent.js";

interface ConvRow {
	conv_id: number;
	user_id: string;
	scenario_id: number;
	catalogue: string;
	mentioned_items: string;
	gt_items: string;
}

interface TurnRow {
	turn: number;
	role: string;
	content: string;
	tags: string;
}

interface SimulationResult {
	convId: number;
	userId: string;
	catalogue: string;
	scenarioId: number;
	transcript: Array<{ turn: number; role: string; content: string }>;
	predictions: Record<string, number>;
	preferences: string;
	toolCalls: Array<{ tool: string; args: any; result: string }>;
}

/** Run a full conversation simulation for a given conversation ID */
export async function simulateConversation(
	convId: number,
	onProgress?: (msg: string) => void,
): Promise<SimulationResult> {
	const db = getDb();
	const log = onProgress ?? console.log;

	// Load conversation metadata
	const conv = db.prepare("SELECT * FROM conversations WHERE conv_id = ?").get(convId) as ConvRow | undefined;
	if (!conv) throw new Error(`Conversation ${convId} not found`);

	// Load seeker turns only
	const allTurns = db
		.prepare("SELECT turn, role, content, tags FROM conversation_turns WHERE conv_id = ? ORDER BY turn")
		.all(convId) as TurnRow[];
	const seekerTurns = allTurns.filter((t) => t.role === "Seeker");

	log(`Simulating conv ${convId}: user=${conv.user_id}, scenario=${conv.scenario_id}, catalogue=${conv.catalogue}`);
	log(`${seekerTurns.length} seeker turns to replay`);

	// Step 1: Cold start — Preference Agent loads taste profile
	log("[PREF AGENT] Running cold start...");
	let preferenceState = await coldStart(conv.user_id, convId);
	log("[PREF AGENT] Cold start complete");

	// Step 2: Create Conversation Agent session
	const systemPrompt = buildSystemPrompt(convId, conv.user_id, conv.scenario_id, conv.catalogue, preferenceState);

	const loader = new DefaultResourceLoader({
		systemPromptOverride: () => systemPrompt,
	});
	await loader.reload();

	const model = getModel("google", "gemini-3-flash-preview");
	const allConvTools: ToolDefinition<any>[] = [...conversationTools, recallHistoryTool];

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "off",
		tools: [],
		customTools: allConvTools,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});

	const transcript: Array<{ turn: number; role: string; content: string }> = [];
	const toolCalls: Array<{ tool: string; args: any; result: string }> = [];

	// Step 3: Conversation loop
	for (const seekerTurn of seekerTurns) {
		log(`\n── Turn ${seekerTurn.turn} ──`);
		log(`Seeker: ${seekerTurn.content.slice(0, 100)}${seekerTurn.content.length > 100 ? "..." : ""}`);

		transcript.push({ turn: seekerTurn.turn, role: "Seeker", content: seekerTurn.content });

		// Send seeker utterance to Conversation Agent
		const agentResponse = await new Promise<string>((resolveResponse) => {
			const textParts: string[] = [];

			const unsub = session.subscribe((event: AgentSessionEvent) => {
				if (event.type === "tool_execution_end") {
					toolCalls.push({
						tool: event.toolName,
						args: event.result,
						result: String(event.result),
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
					unsub();
					resolveResponse(textParts.join("\n"));
				}
			});

			session.prompt(seekerTurn.content);
		});

		log(`Agent: ${agentResponse.slice(0, 100)}${agentResponse.length > 100 ? "..." : ""}`);
		transcript.push({ turn: seekerTurn.turn, role: "Assistant", content: agentResponse });

		// Step 4: Preference Agent monitors the exchange
		log("[PREF AGENT] Monitoring exchange...");
		preferenceState = await monitorExchange(
			conv.user_id,
			convId,
			seekerTurn.content,
			agentResponse,
			preferenceState,
		);
	}

	// Step 5: Rating prediction
	log("\n── Rating Prediction ──");
	const ratingPrompt = buildRatingPrompt(conv.catalogue);

	const predictions = await new Promise<Record<string, number>>((resolveRatings) => {
		const textParts: string[] = [];

		const unsub = session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "message_end" && "role" in event.message && event.message.role === "assistant") {
				const msg = event.message as any;
				for (const block of msg.content ?? []) {
					if (block.type === "text") {
						textParts.push(block.text);
					}
				}
			}
			if (event.type === "agent_end") {
				unsub();
				const fullText = textParts.join("\n");
				try {
					// Extract JSON from response (might be wrapped in markdown code block)
					const jsonMatch = fullText.match(/\{[\s\S]*\}/);
					resolveRatings(jsonMatch ? JSON.parse(jsonMatch[0]) : {});
				} catch {
					log(`Warning: Could not parse ratings: ${fullText}`);
					resolveRatings({});
				}
			}
		});

		session.prompt(ratingPrompt);
	});

	log(`Predictions: ${JSON.stringify(predictions)}`);

	session.dispose();

	// Save results
	const result: SimulationResult = {
		convId,
		userId: conv.user_id,
		catalogue: conv.catalogue,
		scenarioId: conv.scenario_id,
		transcript,
		predictions,
		preferences: preferenceState,
		toolCalls,
	};

	saveResults(result);
	return result;
}

function saveResults(result: SimulationResult): void {
	const dir = resolve(PROJECT_ROOT, "results", `conv_${result.convId}`);
	mkdirSync(dir, { recursive: true });

	writeFileSync(resolve(dir, "transcript.json"), JSON.stringify(result.transcript, null, 2));
	writeFileSync(resolve(dir, "predictions.json"), JSON.stringify(result.predictions, null, 2));
	writeFileSync(resolve(dir, "preferences.txt"), result.preferences);
	writeFileSync(resolve(dir, "tool_calls.json"), JSON.stringify(result.toolCalls, null, 2));

	console.log(`Results saved to: results/conv_${result.convId}/`);
}

/** Run all conversations for a specific user, or all if no user specified */
export async function batchSimulate(userId?: string): Promise<SimulationResult[]> {
	const db = getDb();

	let convs: ConvRow[];
	if (userId) {
		convs = db.prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY conv_id").all(userId) as ConvRow[];
	} else {
		convs = db.prepare("SELECT * FROM conversations ORDER BY conv_id").all() as ConvRow[];
	}

	console.log(`Batch simulation: ${convs.length} conversations`);
	const results: SimulationResult[] = [];

	for (const conv of convs) {
		try {
			const result = await simulateConversation(conv.conv_id);
			results.push(result);
		} catch (e) {
			console.error(`Error simulating conv ${conv.conv_id}:`, e);
		}
	}

	return results;
}
