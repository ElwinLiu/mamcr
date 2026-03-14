import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT || "3000");
const RENDERER_DIR = resolve(__dirname, "..", "electron", "renderer");

// Backend functions (dynamically loaded from compiled dist/)
let getDb: () => any;
let simulateConversation: (convId: number, onEvent?: (event: any) => void) => Promise<any>;
let batchSimulate: (userId?: string) => Promise<any[]>;
let listRuns: (convId: number) => any[];
let loadRun: (convId: number, runId: string) => any;
let evaluateConversation: (convId: number) => any;
let evaluateAll: () => any;

function loadEnv(): void {
	try {
		const envPath = resolve(__dirname, "..", ".env");
		const content = readFileSync(envPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIdx = trimmed.indexOf("=");
			if (eqIdx > 0) {
				const key = trimmed.slice(0, eqIdx).trim();
				let val = trimmed.slice(eqIdx + 1).trim();
				if (
					(val.startsWith('"') && val.endsWith('"')) ||
					(val.startsWith("'") && val.endsWith("'"))
				) {
					val = val.slice(1, -1);
				}
				if (!process.env[key]) {
					process.env[key] = val;
				}
			}
		}
	} catch {
		// .env not found — env vars must be set externally
	}
}

async function loadBackend(): Promise<void> {
	const dist = resolve(__dirname, "..", "dist");
	const mod = (p: string) => pathToFileURL(resolve(dist, p)).href;

	const schema = await import(mod("db/schema.js"));
	getDb = schema.getDb;
	schema.initSchema(schema.getDb());

	const orch = await import(mod("orchestrator.js"));
	simulateConversation = orch.simulateConversation;
	batchSimulate = orch.batchSimulate;
	listRuns = orch.listRuns;
	loadRun = orch.loadRun;

	const metrics = await import(mod("eval/metrics.js"));
	evaluateConversation = metrics.evaluateConversation;
	evaluateAll = metrics.evaluateAll;
}

// ── Helpers ──

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
};

function serveStatic(res: ServerResponse, filePath: string): boolean {
	if (!existsSync(filePath)) return false;
	const ext = extname(filePath);
	res.writeHead(200, {
		"Content-Type": MIME[ext] || "application/octet-stream",
		"Cache-Control": "no-cache, no-store, must-revalidate",
	});
	res.end(readFileSync(filePath));
	return true;
}

function json(res: ServerResponse, data: any, status = 200): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function errorResponse(res: ServerResponse, msg: string, status = 400): void {
	json(res, { error: msg }, status);
}

async function readBody(req: IncomingMessage): Promise<any> {
	return new Promise((resolve) => {
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk;
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(body));
			} catch {
				resolve({});
			}
		});
	});
}

// ── Request handler ──

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const url = new URL(req.url || "/", `http://localhost:${PORT}`);
	const path = url.pathname;

	// ── API routes ──
	if (path.startsWith("/api/")) {
		try {
			return await handleApi(req, res, url);
		} catch (err: any) {
			return errorResponse(res, err.message || "Internal error", 500);
		}
	}

	// ── Static files ──
	if (path === "/") {
		serveStatic(res, resolve(RENDERER_DIR, "index.html"));
		return;
	}

	const filePath = resolve(RENDERER_DIR, "." + path);
	// Prevent directory traversal
	if (filePath.startsWith(RENDERER_DIR) && serveStatic(res, filePath)) return;

	res.writeHead(404);
	res.end("Not found");
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
	const path = url.pathname;

	// ── Database ──

	if (path === "/api/db/list-conversations") {
		return json(
			res,
			getDb()
				.prepare(
					`SELECT c.conv_id, c.user_id, c.scenario_id, c.catalogue, c.summary,
					        COUNT(ct.turn) AS turn_count
					 FROM conversations c
					 LEFT JOIN conversation_turns ct ON c.conv_id = ct.conv_id
					 GROUP BY c.conv_id
					 ORDER BY c.conv_id`,
				)
				.all(),
		);
	}

	if (path === "/api/db/list-users") {
		return json(
			res,
			getDb()
				.prepare(
					`SELECT u.*,
					        COUNT(DISTINCT c.conv_id) AS conv_count,
					        COUNT(DISTINCT up.id) AS pref_count
					 FROM users u
					 LEFT JOIN conversations c ON u.user_id = c.user_id
					 LEFT JOIN user_preferences up ON u.user_id = up.user_id
					 GROUP BY u.user_id
					 ORDER BY u.user_id`,
				)
				.all(),
		);
	}

	if (path === "/api/db/list-items") {
		return json(res, getDb().prepare("SELECT * FROM items ORDER BY catalogue, item_id").all());
	}

	if (path === "/api/db/get-conversation") {
		const convId = parseInt(url.searchParams.get("convId") || "0");
		const db = getDb();
		const conv = db.prepare("SELECT * FROM conversations WHERE conv_id = ?").get(convId);
		const turns = db
			.prepare(
				"SELECT turn, role, content, tags FROM conversation_turns WHERE conv_id = ? ORDER BY turn",
			)
			.all(convId);
		const prefs = db
			.prepare("SELECT description FROM user_preferences WHERE source_conv_id = ?")
			.all(convId);
		const scenario = conv
			? db
					.prepare("SELECT body FROM scenarios WHERE scenario_id = ?")
					.get((conv as any).scenario_id)
			: null;
		return json(res, { conv, turns, prefs, scenario });
	}

	if (path === "/api/db/get-taste-profile") {
		const userId = url.searchParams.get("userId") || "";
		const db = getDb();
		const user = db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
		const prefs = db
			.prepare(
				"SELECT description, source_conv_id FROM user_preferences WHERE user_id = ? ORDER BY id",
			)
			.all(userId);
		return json(res, { user, prefs });
	}

	if (path === "/api/db/sql-query" && req.method === "POST") {
		const body = await readBody(req);
		const query = (body.query || "").trim();
		const upper = query.toUpperCase();
		if (!upper.startsWith("SELECT")) throw new Error("Only SELECT queries allowed");
		if (/\b(ratings|item_embeddings)\b/i.test(query)) {
			throw new Error("Access to ratings and item_embeddings is restricted");
		}
		return json(res, getDb().prepare(query).all());
	}

	// ── Simulation (SSE for progress streaming) ──

	if (path === "/api/sim/run") {
		const convId = parseInt(url.searchParams.get("convId") || "0");
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});

		try {
			const result = await simulateConversation(convId, (event) => {
				res.write(`event: sim\ndata: ${JSON.stringify(event)}\n\n`);
			});
			res.write(`event: result\ndata: ${JSON.stringify(result)}\n\n`);
		} catch (err: any) {
			console.error(`Simulation error (conv ${convId}):`, err);
			res.write(`event: sim_error\ndata: ${JSON.stringify(err.message || String(err))}\n\n`);
		}
		res.end();
		return;
	}

	if (path === "/api/sim/batch" && req.method === "POST") {
		const body = await readBody(req);
		const results = await batchSimulate(body.userId || undefined);
		return json(res, results);
	}

	if (path === "/api/sim/runs") {
		const convId = parseInt(url.searchParams.get("convId") || "0");
		return json(res, listRuns(convId));
	}

	if (path === "/api/sim/runs/load") {
		const convId = parseInt(url.searchParams.get("convId") || "0");
		const runId = url.searchParams.get("runId") || "";
		return json(res, loadRun(convId, runId));
	}

	// ── Evaluation ──

	if (path === "/api/eval/conversation") {
		const convId = parseInt(url.searchParams.get("convId") || "0");
		return json(res, evaluateConversation(convId));
	}

	if (path === "/api/eval/all") {
		const result = evaluateAll();
		const perConv: Record<number, any> = {};
		for (const [k, v] of result.perConv) {
			perConv[k] = v;
		}
		return json(res, { perConv, aggregate: result.aggregate });
	}

	errorResponse(res, "Not found", 404);
}

// ── Start ──

async function main() {
	loadEnv();
	console.log("Loading backend...");
	await loadBackend();
	console.log("Backend loaded.");

	const server = createServer((req, res) => {
		handleRequest(req, res).catch((err) => {
			console.error("Request error:", err);
			if (!res.headersSent) {
				res.writeHead(500);
				res.end("Internal server error");
			}
		});
	});

	server.listen(PORT, "0.0.0.0", () => {
		console.log(`MAMCR running at http://localhost:${PORT}`);
	});
}

main().catch(console.error);
