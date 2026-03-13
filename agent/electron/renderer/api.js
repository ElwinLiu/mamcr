// API client — implements window.mamcr using fetch (replaces Electron preload)
(function () {
	const _simEventCallbacks = [];

	window.mamcr = {
		// Database
		listConversations: () => fetch("/api/db/list-conversations").then((r) => r.json()),
		listUsers: () => fetch("/api/db/list-users").then((r) => r.json()),
		listItems: () => fetch("/api/db/list-items").then((r) => r.json()),
		getConversation: (convId) =>
			fetch("/api/db/get-conversation?convId=" + convId).then((r) => r.json()),
		getTasteProfile: (userId) =>
			fetch("/api/db/get-taste-profile?userId=" + encodeURIComponent(userId)).then((r) =>
				r.json(),
			),
		sqlQuery: (query) =>
			fetch("/api/db/sql-query", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query }),
			}).then((r) => r.json()),

		// Simulation — uses Server-Sent Events for structured event streaming
		runSimulation: (convId) => {
			return new Promise((resolve, reject) => {
				const es = new EventSource("/api/sim/run?convId=" + convId);
				es.addEventListener("sim", (e) => {
					try {
						const event = JSON.parse(e.data);
						for (const cb of _simEventCallbacks) cb(event);
					} catch {}
				});
				es.addEventListener("result", (e) => {
					es.close();
					resolve(JSON.parse(e.data));
				});
				es.addEventListener("error", (e) => {
					es.close();
					reject(new Error("Simulation failed or connection lost"));
				});
			});
		},
		onSimEvent: (callback) => {
			_simEventCallbacks.push(callback);
			return () => {
				const i = _simEventCallbacks.indexOf(callback);
				if (i >= 0) _simEventCallbacks.splice(i, 1);
			};
		},

		batchSimulate: (userId) =>
			fetch("/api/sim/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userId }),
			}).then((r) => r.json()),

		// Evaluation
		evaluateConversation: (convId) =>
			fetch("/api/eval/conversation?convId=" + convId).then((r) => r.json()),
		evaluateAll: () => fetch("/api/eval/all").then((r) => r.json()),
	};
})();
