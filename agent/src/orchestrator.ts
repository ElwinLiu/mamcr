/**
 * Orchestrator: Coordinates the 3 agents for a full conversation simulation.
 *
 * Flow:
 * 1. Cold start: Preference Agent loads taste profile
 * 2. Per turn: Replay original exchange (both sides from DB) →
 *    Conversation Agent observes + uses tools → Preference Agent monitors
 * 3. Post-conversation: Conversation Agent predicts ratings
 *
 * The Conversation Agent never generates responses — it observes the original
 * human conversation and gathers context for the final rating prediction.
 */
import {
	createAgentSession,
	SessionManager,
	DefaultResourceLoader,
	type AgentSessionEvent,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, PROJECT_ROOT } from "./db/schema.js";
import { enterSimulationScope, exitSimulationScope } from "./db/scope.js";
import { conversationTools } from "./tools/index.js";
import { createRecallHistoryTool } from "./agents/history-agent.js";
import { coldStart, monitorExchange } from "./agents/preference-agent.js";
import { buildSystemPrompt, buildObservePrompt, buildRatingPrompt } from "./agents/conversation-agent.js";

// ── Event types ──

export type SimEvent =
	| { type: "status"; message: string }
	| { type: "turn_start"; turn: number }
	| { type: "seeker"; turn: number; content: string }
	| { type: "assistant"; turn: number; content: string }
	| { type: "tool_call"; agent: string; tool: string; args: any; result: string }
	| { type: "agent_output"; agent: string; phase: string; content: string }
	| { type: "context"; label: string; source: string; content: string };

// ── Interfaces ──

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

interface ToolCallRecord {
	agent: string;
	tool: string;
	args: any;
	result: string;
}

interface SimulationResult {
	convId: number;
	userId: string;
	catalogue: string;
	scenarioId: number;
	transcript: Array<{ turn: number; role: string; content: string }>;
	predictions: Record<string, number>;
	preferences: string;
	toolCalls: ToolCallRecord[];
}

/** Extract readable text from a tool result (MCP-style object or plain string) */
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

/** Run a full conversation simulation for a given conversation ID */
export async function simulateConversation(
	convId: number,
	onEvent?: (event: SimEvent) => void,
): Promise<SimulationResult> {
	const events: SimEvent[] = [];
	const emit = (e: SimEvent) => {
		events.push(e);
		if (onEvent) onEvent(e);
		else if (e.type === "status") console.log(e.message);
	};

	const db = getDb();

	// Load conversation metadata
	const conv = db.prepare("SELECT * FROM conversations WHERE conv_id = ?").get(convId) as ConvRow | undefined;
	if (!conv) throw new Error(`Conversation ${convId} not found`);

	// Load all turns in order and pair sequential Seeker→Assistant exchanges
	const allTurns = db
		.prepare("SELECT turn, role, content, tags FROM conversation_turns WHERE conv_id = ? ORDER BY turn")
		.all(convId) as TurnRow[];

	const exchanges: Array<{ turn: number; seeker: string; assistant: string }> = [];
	for (let i = 0; i < allTurns.length; i++) {
		const t = allTurns[i];
		if (t.role === "Seeker") {
			// Look for the next Assistant turn
			const next = allTurns[i + 1];
			const assistantContent = next && next.role === "Assistant" ? next.content : "";
			exchanges.push({ turn: t.turn, seeker: t.content, assistant: assistantContent });
		}
	}

	emit({ type: "status", message: `Simulating conv ${convId}: user=${conv.user_id}, scenario=${conv.scenario_id}, catalogue=${conv.catalogue}` });
	emit({ type: "status", message: `${exchanges.length} exchanges to replay` });

	const toolCalls: ToolCallRecord[] = [];
	const transcript: Array<{ turn: number; role: string; content: string }> = [];

	// ── Set up simulation scope — all DB access is now filtered ──
	enterSimulationScope(convId);

	try {
		// ── Step 1: Cold start — Preference Agent loads taste profile ──

		emit({ type: "status", message: "[PREF AGENT] Running cold start..." });
		const coldStartResult = coldStart(conv.user_id);
		let preferenceState = coldStartResult.text;

		for (const tc of coldStartResult.toolCalls) {
			emit({ type: "tool_call", agent: "preference", tool: tc.tool, args: tc.args, result: tc.result });
			toolCalls.push({ agent: "preference", ...tc });
		}
		emit({ type: "agent_output", agent: "preference", phase: "cold_start", content: preferenceState });
		emit({ type: "status", message: "[PREF AGENT] Cold start complete" });

		// ── Step 2: Create Conversation Agent session (observer mode) ──

		const { prompt: systemPrompt, scenario, itemList } = buildSystemPrompt(
			convId, conv.user_id, conv.scenario_id, conv.catalogue, preferenceState,
		);

		emit({ type: "context", label: "Scenario", source: `scenarios (id: ${conv.scenario_id})`, content: scenario });
		emit({ type: "context", label: "Catalogue Items", source: `items (catalogue: ${conv.catalogue})`, content: itemList });
		emit({ type: "context", label: "Taste Profile", source: "Preference Agent (cold start)", content: preferenceState });

		const loader = new DefaultResourceLoader({
			systemPromptOverride: () => systemPrompt,
		});
		await loader.reload();

		const model = getModel("google", "gemini-3-flash-preview");

		const recallTool = createRecallHistoryTool((tc) => {
			emit({ type: "tool_call", agent: "history", tool: tc.tool, args: tc.args, result: tc.result });
			toolCalls.push({ agent: "history", ...tc });
		});

		const allConvTools: ToolDefinition<any>[] = [...conversationTools, recallTool];

		const { session } = await createAgentSession({
			model,
			thinkingLevel: "off",
			tools: [],
			customTools: allConvTools,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(),
		});

		// ── Step 3: Conversation loop — observe original exchanges ──

		for (const exchange of exchanges) {
			emit({ type: "turn_start", turn: exchange.turn });
			emit({ type: "seeker", turn: exchange.turn, content: exchange.seeker });
			emit({ type: "assistant", turn: exchange.turn, content: exchange.assistant });

			transcript.push({ turn: exchange.turn, role: "Seeker", content: exchange.seeker });
			transcript.push({ turn: exchange.turn, role: "Assistant", content: exchange.assistant });

			// Conversation Agent observes and may call tools to gather context
			const observePrompt = buildObservePrompt(exchange.turn, exchange.seeker, exchange.assistant);

			const observation = await new Promise<string>((resolveObs) => {
				const textParts: string[] = [];
				const pendingArgs = new Map<string, any>();

				const unsub = session.subscribe((event: AgentSessionEvent) => {
					if (event.type === "tool_execution_start") {
						const e = event as any;
						pendingArgs.set(e.toolCallId, e.args ?? {});
					}
					if (event.type === "tool_execution_end") {
						const e = event as any;
						const args = pendingArgs.get(e.toolCallId) ?? {};
						pendingArgs.delete(e.toolCallId);
						const result = extractToolResult(e.result);

						toolCalls.push({ agent: "conversation", tool: e.toolName, args, result });
						emit({ type: "tool_call", agent: "conversation", tool: e.toolName, args, result });
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
						resolveObs(textParts.join("\n"));
					}
				});

				session.prompt(observePrompt);
			});

			if (observation.trim()) {
				emit({ type: "agent_output", agent: "conversation", phase: "observe", content: observation });
			}

			// ── Preference Agent monitors the exchange ──

			emit({ type: "status", message: "[PREF AGENT] Monitoring exchange..." });
			const monitorResult = await monitorExchange(
				conv.user_id,
				convId,
				exchange.seeker,
				exchange.assistant,
				preferenceState,
			);
			preferenceState = monitorResult.text;

			for (const tc of monitorResult.toolCalls) {
				emit({ type: "tool_call", agent: "preference", tool: tc.tool, args: tc.args, result: tc.result });
				toolCalls.push({ agent: "preference", ...tc });
			}
			emit({ type: "agent_output", agent: "preference", phase: "monitor", content: monitorResult.text });
			emit({ type: "context", label: "Taste Profile", source: "Preference Agent (updated)", content: preferenceState });
		}

		// ── Step 4: Rating prediction ──

		emit({ type: "status", message: "── Rating Prediction ──" });
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
						const jsonMatch = fullText.match(/\{[\s\S]*\}/);
						resolveRatings(jsonMatch ? JSON.parse(jsonMatch[0]) : {});
					} catch {
						emit({ type: "status", message: `Warning: Could not parse ratings: ${fullText}` });
						resolveRatings({});
					}
				}
			});

			session.prompt(ratingPrompt);
		});

		emit({ type: "status", message: `Predictions: ${JSON.stringify(predictions)}` });

		session.dispose();

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

		saveRun(result, events);
		return result;
	} finally {
		exitSimulationScope();
	}
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
