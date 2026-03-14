/**
 * Simulation Scope: Creates a database-level boundary that prevents
 * contamination from the test conversation.
 *
 * All exclusion logic lives here — individual tools don't need to know
 * which conversation is being tested. They query views instead of base
 * tables, and the views automatically exclude the right data.
 */
import { getDb } from "./schema.js";

/** NOTE: Only one simulation may run at a time — this is process-global state.
 *  If concurrent simulations are ever needed, replace with a context object. */
let activeScope: number | null = null;

/** Set up temp views that exclude the test conversation's data. */
export function enterSimulationScope(excludeConvId: number): void {
	const db = getDb();

	// Always drop first to avoid stale views from a prior scope or crash
	db.exec("DROP VIEW IF EXISTS v_user_preferences");
	db.exec("DROP VIEW IF EXISTS v_conversations");
	db.exec("DROP VIEW IF EXISTS v_conversation_turns");

	// Preferences from other conversations only
	db.prepare(`
		CREATE TEMP VIEW v_user_preferences AS
		SELECT id, user_id, source_conv_id, description
		FROM user_preferences
		WHERE source_conv_id != ?
	`).run(excludeConvId);

	// Other conversations (full metadata minus gt_items)
	db.prepare(`
		CREATE TEMP VIEW v_conversations AS
		SELECT conv_id, user_id, scenario_id, catalogue, mentioned_items, summary
		FROM conversations
		WHERE conv_id != ?
	`).run(excludeConvId);

	// Other conversation turns only
	db.prepare(`
		CREATE TEMP VIEW v_conversation_turns AS
		SELECT conv_id, turn, role, content, tags
		FROM conversation_turns
		WHERE conv_id != ?
	`).run(excludeConvId);

	activeScope = excludeConvId;
}

/** Drop the temp views. */
export function exitSimulationScope(): void {
	if (activeScope === null) return;

	const db = getDb();
	db.exec("DROP VIEW IF EXISTS v_user_preferences");
	db.exec("DROP VIEW IF EXISTS v_conversations");
	db.exec("DROP VIEW IF EXISTS v_conversation_turns");

	activeScope = null;
}

export function getActiveScope(): number | null {
	return activeScope;
}

/** Return the scoped view name if in simulation, otherwise the base table. */
export function scopedTable(base: string): string {
	return activeScope !== null ? `v_${base}` : base;
}
