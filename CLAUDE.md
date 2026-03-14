# MAMCR — Multi-Agent Multi-Model Conversational Recommendation

## What This Project Is

MAMCR is a multi-agent framework that predicts how users (Seekers) would rate fashion items after a conversational recommendation session. It is built on the **VOGUE dataset** (Visual-recommendation dialOgue with Grounded User Evaluations), which contains 60 real human-human dialogues in fashion shopping scenarios.

The VOGUE paper benchmarks standalone MLLMs (GPT-4o-mini, GPT-5-mini, Gemini-2.5-Flash) against human Assistants and finds that LLMs underperform — they struggle with calibration, generalization beyond discussed items, and reproducing human rating distributions. MAMCR proposes a multi-agent architecture to improve on this.

## How It Works

The system replays each VOGUE conversation (Seeker + human Assistant) and has three specialized agents observe it, then predicts 1-5 ratings for all 12 catalogue items.

### Agent Pipeline

1. **Preference Agent** — Monitors each exchange incrementally. Receives the full conversation history up to the current turn plus its own previous analysis, and outputs only *new* preference signals per turn. These are injected into the Conversation Agent's context. (The cold-start taste profile is loaded programmatically by the orchestrator — a plain function, not an agent — before the agent loop begins.)

2. **Conversation Agent** — Observes each replayed exchange in order. Has access to tools (`sql_query`, `catalogue_search`, `compare_items`, `recall_history`) for progressive context gathering. After all turns, predicts item ratings.

3. **History Agent** — Invoked on-demand by the Conversation Agent via `recall_history`. Searches the user's *other* conversations (scoped to exclude the test conversation) for relevant preference history.

### Data Isolation

During simulation, scoped DB views (`v_conversations`, `v_conversation_turns`, `v_user_preferences`) automatically exclude the test conversation to prevent ground-truth contamination. The `ratings` table is never in any tool's allowlist. SQL queries are validated against a table allowlist and quoted identifiers are rejected.

### Evaluation

Predictions are compared against ground-truth Seeker ratings using MAE, Pearson Correlation, Accuracy, and M-MAE (macro-averaged MAE across rating classes), matching the metrics from the VOGUE paper.

## Key Constraint

The agents observe but never generate dialogue — both sides of the conversation come from the dataset. The system's job is to build understanding through observation and tool use, then predict ratings.
