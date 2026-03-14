/**
 * Shared utilities for running agent sessions to completion.
 *
 * Eliminates the duplicated subscribe→collect→resolve pattern across
 * orchestrator, preference-agent, and history-agent.
 */
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export interface PromptResult {
	text: string;
	toolCalls: Array<{ tool: string; args: any; result: string }>;
}

interface RunPromptOptions {
	/** Called when a tool execution completes. Use for side-effects like logging/emitting. */
	onToolCall?: (tc: { tool: string; args: any; result: string }) => void;
}

/** Extract readable text from a tool result (MCP-style object or plain string) */
export function extractToolResult(result: any): string {
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

/**
 * Run a prompt on a session and collect the full response (text + tool calls).
 *
 * Subscribes to session events, collects text from assistant messages and
 * tool call records, resolves on `agent_end`, rejects on prompt error.
 */
export function runPromptToCompletion(
	session: { subscribe: (cb: (event: AgentSessionEvent) => void) => () => void; prompt: (text: string) => Promise<void> },
	prompt: string,
	opts?: RunPromptOptions,
): Promise<PromptResult> {
	return new Promise<PromptResult>((resolve, reject) => {
		const textParts: string[] = [];
		const toolCalls: PromptResult["toolCalls"] = [];
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
				const tc = { tool: e.toolName, args, result: extractToolResult(e.result) };
				toolCalls.push(tc);
				opts?.onToolCall?.(tc);
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
				resolve({ text: textParts.join("\n"), toolCalls });
			}
		});

		session.prompt(prompt).catch((err) => {
			unsub();
			reject(err);
		});
	});
}
