export { catalogueSearchTool } from "./catalogue-search.js";
export { compareItemsTool } from "./compare-items.js";
export { sqlQueryTool } from "./sql-query.js";
export { updatePreferenceTool } from "./update-preference.js";
export { loadTasteProfileTool } from "./load-taste-profile.js";
export { getConversationTool } from "./get-conversation.js";

import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { catalogueSearchTool } from "./catalogue-search.js";
import { compareItemsTool } from "./compare-items.js";
import { sqlQueryTool } from "./sql-query.js";
import { updatePreferenceTool } from "./update-preference.js";
import { loadTasteProfileTool } from "./load-taste-profile.js";
import { getConversationTool } from "./get-conversation.js";

// Use ToolDefinition<any> for arrays to avoid variance issues with typed schemas
type AnyTool = ToolDefinition<any>;

/** Tools available to the Conversation Agent */
export const conversationTools: AnyTool[] = [catalogueSearchTool, compareItemsTool, sqlQueryTool];

/** Tools available to the Preference Agent */
export const preferenceTools: AnyTool[] = [loadTasteProfileTool, updatePreferenceTool, sqlQueryTool];

/** Tools available to the History Agent */
export const historyTools: AnyTool[] = [getConversationTool, sqlQueryTool];

/** All custom tools */
export const allCustomTools: AnyTool[] = [
	catalogueSearchTool,
	compareItemsTool,
	sqlQueryTool,
	updatePreferenceTool,
	loadTasteProfileTool,
	getConversationTool,
];
