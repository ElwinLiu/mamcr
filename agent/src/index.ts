/**
 * MAMCR Agent — Multi-Agent Multimodal Conversational Recommendation
 *
 * Entry point: sets up the Pi-mono InteractiveMode with custom tools,
 * prompt templates (slash commands), and the MAMCR system prompt.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createAgentSession,
	InteractiveMode,
	DefaultResourceLoader,
	SessionManager,
	type ToolDefinition,
	type PromptTemplate,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { getDb, initSchema } from "./db/schema.js";
import { allCustomTools } from "./tools/index.js";
import { recallHistoryTool } from "./agents/history-agent.js";
import { simulateConversation, batchSimulate } from "./orchestrator.js";
import { extractAll } from "./extract.js";
import { evaluateConversation, evaluateAll, formatMetrics } from "./eval/metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// GEMINI_API_KEY must be set in the environment (e.g. via .env file)
if (!process.env.GEMINI_API_KEY) {
	console.error("Error: GEMINI_API_KEY environment variable is required. Set it in agent/.env or your shell.");
	process.exit(1);
}

// ============================================================================
// Orchestration tools (exposed to the LLM so slash commands can trigger them)
// ============================================================================

const simulateParams = Type.Object({
	conv_id: Type.Number({ description: "Conversation ID to simulate" }),
});

const simulateConversationTool: ToolDefinition<typeof simulateParams> = {
	name: "simulate_conversation",
	label: "Simulate Conversation",
	description: "Run a full conversation simulation for a given conversation ID.",
	parameters: simulateParams,
	async execute(_toolCallId, params) {
		const result = await simulateConversation(params.conv_id);
		const text = [
			`## Simulation Complete: Conversation ${result.convId}`,
			`User: ${result.userId} | Catalogue: ${result.catalogue} | Scenario: ${result.scenarioId}`,
			`Turns: ${result.transcript.length}`,
			`Predictions: ${JSON.stringify(result.predictions)}`,
			`Tool calls: ${result.toolCalls.length}`,
			`Results saved to: results/conv_${result.convId}/`,
		].join("\n");
		return { content: [{ type: "text" as const, text }], details: {} };
	},
};

const batchParams = Type.Object({
	user_id: Type.Optional(Type.String({ description: "Filter to a specific user (e.g. 's1')" })),
});

const batchSimulateTool: ToolDefinition<typeof batchParams> = {
	name: "batch_simulate",
	label: "Batch Simulate",
	description: "Run conversation simulations for all conversations, or all for a specific user.",
	parameters: batchParams,
	async execute(_toolCallId, params) {
		const results = await batchSimulate(params.user_id);
		const text = [
			`## Batch Simulation Complete`,
			`Conversations simulated: ${results.length}`,
			...(params.user_id ? [`User: ${params.user_id}`] : []),
			`Results saved to: results/`,
		].join("\n");
		return { content: [{ type: "text" as const, text }], details: {} };
	},
};

const evaluateParams = Type.Object({
	conv_id: Type.Optional(Type.Number({ description: "Evaluate a specific conversation (omit for all)" })),
});

const evaluateTool: ToolDefinition<typeof evaluateParams> = {
	name: "evaluate",
	label: "Evaluate",
	description: "Compute evaluation metrics on simulation results.",
	parameters: evaluateParams,
	async execute(_toolCallId, params) {
		if (params.conv_id) {
			const result = evaluateConversation(params.conv_id);
			if (!result) {
				return {
					content: [{ type: "text" as const, text: `No results found for conversation ${params.conv_id}.` }],
					details: {},
				};
			}
			const text = [
				`## Evaluation: Conversation ${params.conv_id}`,
				`MAE: ${result.mae.toFixed(3)} | PC: ${result.pc.toFixed(3)} | Accuracy: ${result.accuracy.toFixed(3)}`,
				`M-MAE: ${result.mMae.toFixed(3)} | N: ${result.n}`,
			].join("\n");
			return { content: [{ type: "text" as const, text }], details: {} };
		}

		const result = evaluateAll();
		return { content: [{ type: "text" as const, text: formatMetrics(result) }], details: {} };
	},
};

const extractParams = Type.Object({});

const extractAllTool: ToolDefinition<typeof extractParams> = {
	name: "extract_all",
	label: "Extract All",
	description: "Run the taste extraction pipeline on all conversations.",
	parameters: extractParams,
	async execute() {
		await extractAll();
		return {
			content: [{ type: "text" as const, text: "Taste extraction pipeline complete." }],
			details: {},
		};
	},
};

// ============================================================================
// Prompt Templates (slash commands)
// ============================================================================

function loadPromptTemplates(): PromptTemplate[] {
	const promptsDir = resolve(__dirname, "prompts");
	const templates: PromptTemplate[] = [];

	try {
		const files = readdirSync(promptsDir).filter((f) => f.endsWith(".md"));
		for (const file of files) {
			const filePath = resolve(promptsDir, file);
			const content = readFileSync(filePath, "utf-8");
			const name = basename(file, ".md");

			// Parse frontmatter
			const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
			let description = "";
			let body = content;

			if (match) {
				const frontmatter = match[1];
				body = match[2].trim();
				const descMatch = frontmatter.match(/description:\s*(.*)/);
				if (descMatch) description = descMatch[1].trim();
			}

			templates.push({ name, description, source: "(mamcr)", content: body, filePath });
		}
	} catch {
		// prompts dir might not exist in dist
	}

	return templates;
}

// ============================================================================
// Main
// ============================================================================

const SYSTEM_PROMPT = `You are MAMCR — a Multi-Agent Multimodal Conversational Recommendation system.

You help researchers run and evaluate conversation simulations using the VOGUE dataset.

## Available Commands
- /list — List all 60 conversations
- /simulate <conv_id> — Run a conversation simulation
- /batch [--user <id>] — Batch simulate conversations
- /evaluate [<conv_id>] — Compute evaluation metrics
- /taste <user_id> — Inspect a user's taste profile
- /item <item_id> — Inspect item metadata
- /history <user_id> — Show all conversations for a user
- /extract — Run the taste extraction pipeline

## Available Tools
- simulate_conversation — Run a full conversation simulation
- batch_simulate — Run batch simulations
- evaluate — Compute metrics on results
- extract_all — Run taste extraction pipeline
- catalogue_search — Semantic search over items
- compare_items — Compare two items
- sql_query — Query the database (read-only, no access to ratings table)
- load_taste_profile — Load a user's taste profile
- update_preference — Record a preference signal
- get_conversation — Get a conversation transcript
- recall_history — Search user's past conversations

You can answer questions about the VOGUE dataset, run simulations, and help analyze results.`;

async function main(): Promise<void> {
	// Ensure DB is initialized
	const db = getDb();
	initSchema(db);

	const promptTemplates = loadPromptTemplates();

	const loader = new DefaultResourceLoader({
		systemPromptOverride: () => SYSTEM_PROMPT,
		promptsOverride: (current) => ({
			prompts: [...current.prompts, ...promptTemplates],
			diagnostics: current.diagnostics,
		}),
	});
	await loader.reload();

	const model = getModel("google", "gemini-3-flash-preview");

	// All tools: custom data tools + orchestration tools + history agent tool
	const tools: ToolDefinition<any>[] = [
		...allCustomTools,
		recallHistoryTool,
		simulateConversationTool,
		batchSimulateTool,
		evaluateTool,
		extractAllTool,
	];

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "off",
		tools: [],
		customTools: tools,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
	});

	const mode = new InteractiveMode(session, {});
	await mode.run();
}

main().catch(console.error);
