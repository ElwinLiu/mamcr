/**
 * Evaluation metrics for MAMCR.
 * Implements MAE, Pearson Correlation, M-MAE, MAE[GT=k], and Accuracy.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, PROJECT_ROOT } from "../db/schema.js";

interface RatingRow {
	item_id: number;
	rating: number;
}

/** Mean Absolute Error */
export function mae(predicted: number[], actual: number[]): number {
	if (predicted.length === 0) return NaN;
	let sum = 0;
	for (let i = 0; i < predicted.length; i++) {
		sum += Math.abs(predicted[i] - actual[i]);
	}
	return sum / predicted.length;
}

/** Pearson Correlation Coefficient */
export function pearsonCorrelation(predicted: number[], actual: number[]): number {
	if (predicted.length < 2) return NaN;

	const n = predicted.length;
	const meanP = predicted.reduce((a, b) => a + b, 0) / n;
	const meanA = actual.reduce((a, b) => a + b, 0) / n;

	let num = 0;
	let denomP = 0;
	let denomA = 0;

	for (let i = 0; i < n; i++) {
		const dp = predicted[i] - meanP;
		const da = actual[i] - meanA;
		num += dp * da;
		denomP += dp * dp;
		denomA += da * da;
	}

	const denom = Math.sqrt(denomP) * Math.sqrt(denomA);
	if (denom === 0) return NaN;
	return num / denom;
}

/** Exact match accuracy */
export function accuracy(predicted: number[], actual: number[]): number {
	if (predicted.length === 0) return NaN;
	let matches = 0;
	for (let i = 0; i < predicted.length; i++) {
		if (Math.round(predicted[i]) === actual[i]) matches++;
	}
	return matches / predicted.length;
}

/** MAE filtered to items where ground truth = k */
export function maeAtK(predicted: number[], actual: number[], k: number): number {
	const filtered: Array<[number, number]> = [];
	for (let i = 0; i < actual.length; i++) {
		if (actual[i] === k) {
			filtered.push([predicted[i], actual[i]]);
		}
	}
	if (filtered.length === 0) return NaN;
	return mae(
		filtered.map(([p]) => p),
		filtered.map(([, a]) => a),
	);
}

/** Macro-averaged MAE across rating classes (1-5) */
export function macroMae(predicted: number[], actual: number[]): number {
	const maes: number[] = [];
	for (let k = 1; k <= 5; k++) {
		const m = maeAtK(predicted, actual, k);
		if (!isNaN(m)) {
			maes.push(m);
		}
	}
	if (maes.length === 0) return NaN;
	return maes.reduce((a, b) => a + b, 0) / maes.length;
}

/** Compute all metrics for a single conversation */
export function evaluateConversation(convId: number): {
	mae: number;
	pc: number;
	accuracy: number;
	mMae: number;
	maeByClass: Record<number, number>;
	n: number;
} | null {
	const db = getDb();

	// Load ground truth ratings
	const gtRatings = db
		.prepare("SELECT item_id, rating FROM ratings WHERE conv_id = ?")
		.all(convId) as RatingRow[];

	if (gtRatings.length === 0) return null;

	// Load predictions
	const predPath = resolve(PROJECT_ROOT, "results", `conv_${convId}`, "predictions.json");
	let predictions: Record<string, number>;
	try {
		predictions = JSON.parse(readFileSync(predPath, "utf-8"));
	} catch {
		return null;
	}

	// Align predictions with ground truth
	const predicted: number[] = [];
	const actual: number[] = [];

	for (const gt of gtRatings) {
		const pred = predictions[String(gt.item_id)];
		if (pred != null) {
			predicted.push(pred);
			actual.push(gt.rating);
		}
	}

	if (predicted.length === 0) return null;

	const maeByClass: Record<number, number> = {};
	for (let k = 1; k <= 5; k++) {
		const m = maeAtK(predicted, actual, k);
		if (!isNaN(m)) maeByClass[k] = m;
	}

	return {
		mae: mae(predicted, actual),
		pc: pearsonCorrelation(predicted, actual),
		accuracy: accuracy(predicted, actual),
		mMae: macroMae(predicted, actual),
		maeByClass,
		n: predicted.length,
	};
}

/** Compute aggregate metrics across all evaluated conversations */
export function evaluateAll(): {
	perConv: Map<number, ReturnType<typeof evaluateConversation>>;
	aggregate: {
		mae: number;
		pc: number;
		accuracy: number;
		mMae: number;
		maeByClass: Record<number, number>;
		n: number;
	};
} {
	const db = getDb();
	const convs = db.prepare("SELECT conv_id FROM conversations ORDER BY conv_id").all() as Array<{ conv_id: number }>;

	const perConv = new Map<number, ReturnType<typeof evaluateConversation>>();
	const allPredicted: number[] = [];
	const allActual: number[] = [];

	for (const { conv_id } of convs) {
		const result = evaluateConversation(conv_id);
		perConv.set(conv_id, result);

		if (result) {
			// Re-load for aggregate calculation
			const gtRatings = db.prepare("SELECT item_id, rating FROM ratings WHERE conv_id = ?").all(conv_id) as RatingRow[];
			const predPath = resolve(PROJECT_ROOT, "results", `conv_${conv_id}`, "predictions.json");
			try {
				const predictions: Record<string, number> = JSON.parse(readFileSync(predPath, "utf-8"));
				for (const gt of gtRatings) {
					const pred = predictions[String(gt.item_id)];
					if (pred != null) {
						allPredicted.push(pred);
						allActual.push(gt.rating);
					}
				}
			} catch {
				// skip
			}
		}
	}

	const maeByClass: Record<number, number> = {};
	for (let k = 1; k <= 5; k++) {
		const m = maeAtK(allPredicted, allActual, k);
		if (!isNaN(m)) maeByClass[k] = m;
	}

	return {
		perConv,
		aggregate: {
			mae: mae(allPredicted, allActual),
			pc: pearsonCorrelation(allPredicted, allActual),
			accuracy: accuracy(allPredicted, allActual),
			mMae: macroMae(allPredicted, allActual),
			maeByClass,
			n: allPredicted.length,
		},
	};
}

/** Format metrics into a readable table */
export function formatMetrics(result: ReturnType<typeof evaluateAll>): string {
	const { aggregate, perConv } = result;
	const lines: string[] = [
		"## Aggregate Metrics",
		"",
		`| Metric | Value |`,
		`|--------|-------|`,
		`| MAE ↓ | ${aggregate.mae.toFixed(3)} |`,
		`| PC ↑ | ${aggregate.pc.toFixed(3)} |`,
		`| Accuracy ↑ | ${aggregate.accuracy.toFixed(3)} |`,
		`| M-MAE ↓ | ${aggregate.mMae.toFixed(3)} |`,
		`| N | ${aggregate.n} |`,
		"",
		"### MAE by Rating Class",
		"",
		`| GT=k | MAE | Count |`,
		`|------|-----|-------|`,
	];

	for (let k = 1; k <= 5; k++) {
		const m = aggregate.maeByClass[k];
		lines.push(`| ${k} | ${m != null ? m.toFixed(3) : "N/A"} | - |`);
	}

	// Per-conversation summary
	lines.push("", "### Per-Conversation Results", "", "| Conv | MAE | PC | Acc | N |", "|------|-----|----|----|---|");
	for (const [convId, metrics] of perConv) {
		if (metrics) {
			lines.push(
				`| ${convId} | ${metrics.mae.toFixed(3)} | ${metrics.pc.toFixed(3)} | ${metrics.accuracy.toFixed(3)} | ${metrics.n} |`,
			);
		}
	}

	return lines.join("\n");
}
