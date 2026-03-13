# MAMCR: Multi-Agent Multimodal Conversational Recommendation

## Overview

Build a multi-agent system on the VOGUE dataset to test LLM frameworks' ability in Conversational Recommendation (CR). The system actively conducts conversations (playing the Assistant role) by replaying human Seeker utterances from the dataset. Unlike the VOGUE paper's approach (load full transcript into one MLLM, ask for ratings), our system gives the agent realistic prior knowledge about the user and decouples preference tracking and history understanding into dedicated agents.

**Core thesis**: MLLMs in the VOGUE benchmark are evaluated cold — zero context about the user. Human assistants have a structural advantage because they build mental models over time. We close this gap with a cold-start mechanism that distills user preferences from their other conversations, and a multi-agent architecture that separates concerns: preference tracking, history understanding, and conversation management.

**Second motivation**: The VOGUE paper loads the entire conversation transcript and all item metadata into a single prompt — a monolithic context dump. This is unrealistic in production systems, where information must be discovered progressively: an assistant learns preferences through dialogue, retrieves item details on demand, and recalls history selectively. Our architecture enforces progressive disclosure by design — the Conversation Agent starts with only item names and categories, uses tools to drill into details as needed, and accumulates preference signals turn-by-turn rather than seeing everything at once. This mirrors how real recommendation systems operate under context and latency constraints.

---

## Tech Stack

| Component | Choice | Package |
|-----------|--------|---------|
| Language | TypeScript (Node.js) | — |
| Agent framework | Pi-mono SDK | `@mariozechner/pi-coding-agent` |
| Database | SQLite | `better-sqlite3` |
| Embeddings | OpenAI text-embedding-3-small | `openai` |
| LLM backbone | Multi-provider via Pi-mono ModelRegistry | Anthropic, OpenAI, Gemini — swappable per ablation |
| TUI | Pi-mono InteractiveMode | Built into SDK |
| Schema validation | TypeBox | `@sinclair/typebox` (Pi-mono dependency) |

### Pi-mono SDK Documentation

Reference docs for the Pi-mono SDK are available at:
`/home/elwin/code/pi-mono/packages/coding-agent/docs/`

Key files: `sdk.md` (core API), `extensions.md` (custom tools & agents), `prompt-templates.md` (slash commands), `session.md` (session management), `models.md` (model providers).

### Why Pi-mono SDK

- **TUI for free**: `InteractiveMode` provides a full interactive terminal with streaming, chat history, and slash commands out of the box
- **Custom tools are trivial**: Each tool is a `ToolDefinition` (~20 lines) with TypeBox schema + execute function
- **Multi-model**: Swap LLM providers with `getModel("anthropic", "claude-sonnet-4-6")` — built-in support for Anthropic, OpenAI, Google, enabling ablation studies across models
- **Multi-agent via multiple sessions**: Each agent is a separate `createAgentSession()` with its own system prompt and tools. Preference and History agents run as preprocessing steps, producing context text injected into the Conversation Agent's `systemPromptOverride`
- **Slash commands**: Prompt templates (`PromptTemplate`) map directly to `/simulate`, `/evaluate`, `/taste`, etc.
- **Session management**: Built-in persistent sessions for debugging and replaying simulations
- **Batch mode**: `runPrintMode` for headless batch runs (no TUI needed)

### Project Structure

```
mamcr/
├── dataset/                  # existing VOGUE data (CSV, JSON)
├── src/
│   ├── db/
│   │   ├── schema.ts         # SQLite table creation (better-sqlite3)
│   │   └── loader.ts         # CSV/JSON → SQLite (replaces vogue_loader.py)
│   ├── tools/
│   │   ├── catalogue-search.ts
│   │   ├── compare-items.ts
│   │   ├── sql-query.ts
│   │   ├── update-preference.ts
│   │   ├── load-taste-profile.ts
│   │   └── get-conversation.ts
│   ├── agents/
│   │   ├── preference-agent.ts   # separate session → produces context text
│   │   ├── history-agent.ts      # separate session → produces context text
│   │   └── conversation-agent.ts # main session with InteractiveMode
│   ├── orchestrator.ts       # coordinates 3 agents per simulation turn
│   ├── extract.ts            # taste extraction pipeline (pre-experiment)
│   ├── eval/
│   │   └── metrics.ts        # MAE, PC, M-MAE, MAE[GT=k]
│   ├── prompts/              # .md prompt templates for slash commands
│   │   ├── simulate.md
│   │   ├── evaluate.md
│   │   ├── taste.md
│   │   ├── list.md
│   │   └── batch.md
│   └── index.ts              # entry point
├── mamcr.db                  # SQLite database (generated)
├── results/                  # simulation outputs
├── package.json
└── tsconfig.json
```

---

## Background: VOGUE Dataset

- **60 human-human dialogues** across 6 fashion shopping scenarios
- **10 Seekers × 6 scenarios** (each seeker has 2 conversations per catalogue)
- **3 catalogues**: a (outerwear, items 1-12), b (layering, items 13-24), c (shoes, items 25-36)
- **12 items per conversation** with text metadata (name, brand, description, features, reviews) + images
- **Utterance-level intent tags** for both Seeker and Assistant roles
- **5-stage conversation structure**: Preference Elicitation → Recommendation → Critique → Refinement → Final Agreement
- **Dual post-conversation ratings**: Seeker ground-truth (1-5) + Assistant predicted ratings
- **5 Likert satisfaction scores** per conversation
- **User profiles**: style preferences, importance weights, pre-ratings of 40 non-catalogue items

### Key Findings from the Paper

| Problem | Detail |
|---------|--------|
| Rating calibration | MLLMs can't reproduce Seeker's skewed distribution (44% rating-1, 8.6% rating-5) |
| Preference generalization | MLLMs fail on items NOT explicitly discussed in conversation |
| Passive evaluation only | Paper only tests post-hoc rating prediction; no active conversation agents tested |

### Paper's Baseline Results (Table 5)

| Model | Accuracy ↑ | PC ↑ | MAE ↓ | M-MAE ↓ |
|-------|-----------|------|-------|---------|
| Human Assistants | 0.397 | **0.636** | **0.896** | **0.849** |
| GPT-5-mini | 0.344 | 0.083 | 1.296 | 1.543 |
| GPT-4o-mini | 0.156 | 0.000 | 1.619 | 1.491 |
| Gemini-2.5-Flash | **0.406** | 0.057 | 1.356 | 1.681 |
| Gemini-2.0-Flash | 0.402 | 0.041 | 1.356 | 1.772 |
| Baseline: Mode Rating | 0.443 | NaN | 1.219 | 1.932 |

**Key insight**: No MLLM beats human Assistants on correlation (PC). Mode Rating (predict all 1s) beats all MLLMs on raw accuracy due to class imbalance.

### Evaluation Metrics

| Metric | Formula | Measures |
|--------|---------|----------|
| **MAE** | (1/n) Σ \|r̂_i - r_i\| | Magnitude accuracy (lower is better) |
| **PC** | pearson(r̂, r) on centered vectors | Ranking/directional accuracy (higher is better) |
| **Accuracy** | % exact rating matches | Raw match rate |
| **MAE[GT=k]** | MAE filtered to items where ground truth = k | Per-class error (exposes calibration issues) |
| **M-MAE** | Macro-averaged MAE across rating classes | Class-balanced error |

---

## Data Layer: SQLite as the Backbone

All data lives in a single SQLite database. The LLM never reads SQLite directly — every tool returns formatted text. SQLite is the storage engine; a rendering layer produces what the LLM sees.

### Schema

```sql
-- User profiles from VOGUE
CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    style_preferences TEXT,
    style_vibes TEXT,
    purchase_frequency TEXT,
    monthly_spend TEXT,
    best_colors TEXT,
    clothing_feel TEXT,
    -- Likert importance weights (1-5) from profile survey
    comfort INTEGER,
    style INTEGER,
    practicality INTEGER,
    trends INTEGER,
    brand INTEGER,
    self_expression INTEGER,
    sustainability INTEGER,
    price INTEGER,
    color_importance INTEGER
);

-- Item metadata from VOGUE
CREATE TABLE items (
    item_id INTEGER PRIMARY KEY,
    catalogue TEXT,           -- a, b, c
    name TEXT,
    brand TEXT,
    rating REAL,
    categories TEXT,          -- JSON array
    description TEXT,
    about TEXT,               -- JSON array
    details TEXT,             -- JSON object
    reviews TEXT
);

-- Scenario descriptions
CREATE TABLE scenarios (
    scenario_id INTEGER PRIMARY KEY,
    body TEXT
);

-- Conversation metadata
CREATE TABLE conversations (
    conv_id INTEGER PRIMARY KEY,
    user_id TEXT,
    scenario_id INTEGER,
    catalogue TEXT,
    mentioned_items TEXT,     -- JSON array
    gt_items TEXT,            -- JSON array
    summary TEXT,             -- LLM-generated summary (populated during taste extraction)
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (scenario_id) REFERENCES scenarios(scenario_id)
);

-- Conversation turns (full transcript)
CREATE TABLE conversation_turns (
    conv_id INTEGER,
    turn INTEGER,
    role TEXT,                -- Seeker or Assistant
    content TEXT,             -- utterance text
    tags TEXT,                -- JSON array of intent tags
    PRIMARY KEY (conv_id, turn, role)
);

-- User preferences extracted from conversations (cold-start taste profile)
-- Each row is a natural language description of a preference signal
CREATE TABLE user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    source_conv_id INTEGER,  -- which conversation this was extracted from
    description TEXT,         -- natural language preference, e.g. "Prefers lightweight, slim-fit jackets — disliked Item 7 for being too bulky"
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (source_conv_id) REFERENCES conversations(conv_id)
);

-- Ground truth ratings (for evaluation only — NEVER exposed to agents)
CREATE TABLE ratings (
    user_id TEXT,
    conv_id INTEGER,
    item_id INTEGER,
    rating INTEGER,           -- 1-5, -1 for unrated
    PRIMARY KEY (user_id, conv_id, item_id)
);

-- Pre-computed text embeddings for items
CREATE TABLE item_embeddings (
    item_id INTEGER PRIMARY KEY,
    embedding BLOB            -- Float32Array serialized as Buffer
);
```

### Why SQLite

- **Surgical exclusion**: `WHERE user_id = ? AND source_conv_id != ?` — one line to exclude test conversation from taste profile
- **Progressive disclosure**: Agent queries basic item info first (`SELECT name, brand FROM items`), drills into full details on demand
- **Preference persistence**: `update_preference` writes directly to the database, building a durable taste profile across the experiment
- **Single file**: No infrastructure, just a `.db` file in the project

---

## Multi-Agent Architecture

Three agents with distinct responsibilities. The Preference Agent runs automatically after each exchange, injecting updated preference state into the Conversation Agent's context. The History Agent is demand-driven — exposed as a tool that the Conversation Agent calls when it needs historical context. This decouples preference tracking and historical knowledge from the main conversation logic.

```
┌──────────────────────────────────────────────────────────────────┐
│                     CONVERSATION AGENT                           │
│                                                                  │
│  Plays the Assistant role in the conversation                   │
│  Receives injected context from Preference Agent (automatic)   │
│  Calls History Agent on demand via recall_history tool          │
│  Has direct access to: catalogue_search, compare_items, sql,   │
│                         recall_history                           │
│  At final turn: predicts 1-5 ratings for all 12 items           │
│                                                                  │
│  Context window contains:                                       │
│  - Scenario description                                         │
│  - [PREF AGENT] Rendered taste profile + live preference state  │
│  - Basic item metadata (names + categories, injected at start)  │
│  - Conversation transcript so far                               │
└───────────┬──────────────────────────────────┬───────────────────┘
            │ (automatic, every turn)          │ (on demand, via tool)
    ┌───────▼────────┐                 ┌──────▼─────────┐
    │ PREFERENCE      │                 │ HISTORY         │
    │ AGENT           │                 │ AGENT           │
    │                 │                 │                 │
    │ Monitors convo  │                 │ Invoked when    │
    │ Extracts prefs  │                 │ Convo Agent     │
    │ after each      │                 │ calls           │
    │ exchange         │                 │ recall_history  │
    │                 │                 │                 │
    │ Cold start:     │                 │ Searches user's │
    │ loads taste     │                 │ past convos     │
    │ profile from DB │                 │ for relevant    │
    │ (excl. test)    │                 │ context         │
    │                 │                 │                 │
    │ Persists new    │                 │ Can drill into  │
    │ signals to DB   │                 │ any conversation│
    │                 │                 │ via tool call   │
    │ Injects pref    │                 │                 │
    │ summary into    │                 │ Returns synth-  │
    │ convo context   │                 │ esized context  │
    │                 │                 │ as tool result  │
    └───────┬─────────┘                 └──────┬──────────┘
            │                                  │
            ▼                                  ▼
    ┌────────────────────────────────────────────────────┐
    │                    SQLite DB                        │
    │  users, items, conversations, user_preferences,   │
    │  conversation_turns, item_embeddings              │
    └────────────────────────────────────────────────────┘
```

### Agent 1: Preference Agent

**Role**: User preference tracker — cold start and live monitoring.

**Cold start** (called once at conversation start):
1. Query `user_preferences` table: `WHERE user_id = ? AND source_conv_id != ?`
2. Also query `users` table for the user's profile (style preferences, importance weights)
3. Render into a structured taste profile text block
4. Inject into the Conversation Agent's context

**Live monitoring** (called after each full exchange — Seeker utterance + Conversation Agent response):
1. Read both the Seeker utterance and the Conversation Agent's response for that turn
2. Extract preference signals (explicit, implicit, critique, reject) from both sides of the exchange
3. Persist new signals to `user_preferences` table with `source_conv_id` = current conversation
4. Re-render the updated preference summary and inject into context

**Output format** (injected into Conversation Agent context):
```
## User Taste Profile

### From prior conversations (cold start)
- Prefers practical, functional outerwear over fashion-forward pieces
- Favors earth tones and muted colors
- Dislikes bulky or heavy garments; chose a slim cotton jacket over a parka last time
- Values waterproofing and weather resistance
- Price-conscious but willing to pay for quality materials

### Current conversation signals
- Needs a jacket for a farm visit in fall — practical and weather-resistant are key
- Expects muddy paths and possible rain — waterproofing is a hard requirement
- Showed interest in Item 3 — drawn to waxed cotton and military styling
- Rejected Item 7 as too bulky — strongly prefers slim, lightweight fits
```

### Agent 2: History Agent (Tool-Based)

**Role**: Historical context provider — invoked on demand by the Conversation Agent as a tool.

Unlike the Preference Agent (which runs automatically every turn), the History Agent is exposed to the Conversation Agent as a `recall_history` tool. When the Conversation Agent decides it needs historical context — e.g., "has this user shopped for outerwear before?" or "what did they like last time?" — it calls the tool, which spins up the History Agent to search and synthesize relevant past interactions.

**How it works** (invoked via `recall_history` tool):
1. Receives the Conversation Agent's query + user ID + current conversation ID
2. Queries conversation summaries for this user (excluding the current test conversation)
3. Decides which conversations are most relevant to the query
4. Drills into relevant conversations via `get_conversation` tool for detail
5. Returns a synthesized historical context text block to the Conversation Agent

**Why tool-based instead of upfront injection**:
- The Conversation Agent knows *when* history matters — it can pull context at the right moment rather than receiving a fixed dump at startup
- Different turns may call for different historical context (early turns: general style; critique stage: specific item reactions)
- Avoids wasting context window on history that turns out to be irrelevant
- Consistent with the progressive disclosure philosophy

**When it gets called** (typical patterns):
- Same-catalogue conversations: "Last time this user looked at outerwear, they gravitated toward Item 3 and disliked Item 7."
- Cross-catalogue insights: "In shoe conversations, user consistently preferred practical over stylish."
- Mid-conversation pivots: User mentions something that triggers a history lookup

**Output format** (returned to Conversation Agent as tool result):
```
## Historical Context

### Same catalogue (outerwear) — Conversation 2, Scenario: Campus Day
- User previously explored Items 2, 3, 7 for a campus outfit
- Chose Item 2 (cotton lightweight jacket) as final pick
- Valued: comfort, easy to move in, not too formal
- Disliked: overly structured or heavy options

### Cross-catalogue insights
- In shoe conversations, user consistently preferred practical over stylish
- User mentioned "I walk a lot" across multiple scenarios — mobility is important
```

### Agent 3: Conversation Agent (Main)

**Role**: Plays the Assistant in the conversation. Responds to replayed Seeker utterances.

**Context at start**:
- Scenario description (from `scenarios` table)
- Basic item metadata for the 12 catalogue items (names + categories only — progressive disclosure)
- Taste profile (injected by Preference Agent)

**Available tools**:
- `catalogue_search`: Find items matching a natural language query
- `compare_items`: Structured attribute comparison between two items
- `sql_query`: Query detailed item metadata, user profile, etc. on demand
- `recall_history`: Invoke the History Agent to search and synthesize relevant past interactions for this user

**Behavior**:
- Follows the 5-stage conversation structure naturally
- Uses `catalogue_search` for grounded item retrieval (not hallucinated recommendations)
- Uses `compare_items` for factual critique responses
- Uses `sql_query` for progressive disclosure of item details (reviews, full description, etc.)

**Rating prediction** (after final turn):
- The Conversation Agent itself predicts 1-5 ratings for all 12 items
- It has access to: the full conversation transcript, accumulated preference state, taste profile, historical context, and all item metadata
- The LLM IS the prediction model — no separate `predict_all_ratings` function
- Output: `{item_id: predicted_rating}` for all 12 items in the catalogue

---

## Tools

All tools are implemented as Pi-mono `ToolDefinition` objects with TypeBox parameter schemas. Each tool's `execute` function receives validated params, interacts with SQLite via `better-sqlite3`, and returns formatted text content.

### Tool 1: Embedding-Based Catalogue Search

```typescript
const catalogueSearchTool: ToolDefinition = {
  name: "catalogue_search",
  label: "Catalogue Search",
  description: "Semantic search over items in a catalogue using text embeddings.",
  parameters: Type.Object({
    query: Type.String({ description: "Natural language description of desired attributes" }),
    catalogue: Type.String({ description: '"a", "b", or "c"' }),
    top_k: Type.Optional(Type.Number({ description: "Number of results (default 4)" })),
  }),
  execute: async (toolCallId, params, onUpdate, ctx, signal) => {
    // cosine similarity against pre-computed embeddings in item_embeddings table
    // returns ranked list with similarity scores and basic metadata
  },
};
```

- **Embedding model**: OpenAI `text-embedding-3-small` over concatenated metadata (name + description + about + details)
- **Index**: 12 items per catalogue, brute-force cosine similarity (no need for vector DB)
- **Purpose**: Grounded retrieval prevents hallucinated recommendations

### Tool 2: Item Comparison

```typescript
const compareItemsTool: ToolDefinition = {
  name: "compare_items",
  label: "Compare Items",
  description: "Structured comparison between two catalogue items.",
  parameters: Type.Object({
    item_a_id: Type.Number({ description: "First item ID" }),
    item_b_id: Type.Number({ description: "Second item ID" }),
  }),
  execute: async (toolCallId, params, onUpdate, ctx, signal) => {
    // queries both items from SQLite, returns formatted attribute-level diff
  },
};
```

- Grounded in item metadata JSON
- Used during critique/refinement stages for factual responses

### Tool 3: Preference Model Update

```typescript
const updatePreferenceTool: ToolDefinition = {
  name: "update_preference",
  label: "Update Preference",
  description: "Persist a preference signal as a descriptive string to the database.",
  parameters: Type.Object({
    user_id: Type.String({ description: "The seeker's ID" }),
    conv_id: Type.Number({ description: "Current conversation ID (used as source_conv_id)" }),
    description: Type.String({
      description: 'Natural language preference, e.g. "Prefers lightweight, slim-fit jackets"',
    }),
  }),
  execute: async (toolCallId, params, onUpdate, ctx, signal) => {
    // INSERT INTO user_preferences (user_id, source_conv_id, description) VALUES (?, ?, ?)
    // returns confirmation with current preference count
  },
};
```

- Writes directly to `user_preferences` table in SQLite
- `source_conv_id` is set to the current conversation being simulated
- These persisted preferences become part of future cold-start profiles (when this conversation is not the one being tested)
- Descriptions are free-form — the Preference Agent decides how to phrase them based on the conversation context

### Tool 4: Load Taste Profile (Cold Start)

```typescript
const loadTasteProfileTool: ToolDefinition = {
  name: "load_taste_profile",
  label: "Load Taste Profile",
  description: "Load user's pre-extracted preference profile, excluding the test conversation.",
  parameters: Type.Object({
    user_id: Type.String({ description: "The seeker's ID" }),
    exclude_conv_id: Type.Number({ description: "Conversation ID to exclude (the one being tested)" }),
  }),
  execute: async (toolCallId, params, onUpdate, ctx, signal) => {
    // SELECT description FROM user_preferences WHERE user_id = ? AND source_conv_id != ?
    // + SELECT * FROM users WHERE user_id = ?
    // returns formatted taste profile text
  },
};
```

- Queries `user_preferences WHERE user_id = ? AND source_conv_id != ?`
- Also queries `users` table for profile data
- Renders as structured text for the Preference Agent

### Tool 5: Get Conversation

```typescript
const getConversationTool: ToolDefinition = {
  name: "get_conversation",
  label: "Get Conversation",
  description: "Retrieve full conversation transcript and metadata.",
  parameters: Type.Object({
    conv_id: Type.Number({ description: "Conversation ID" }),
  }),
  execute: async (toolCallId, params, onUpdate, ctx, signal) => {
    // returns formatted conversation with turns, scenario, mentioned items,
    // and any preference signals previously extracted from it
  },
};
```

- Used by the History Agent to drill into specific past conversations
- Returns transcript + metadata + previously extracted preference signals

### Tool 6: SQL Query

```typescript
const sqlQueryTool: ToolDefinition = {
  name: "sql_query",
  label: "SQL Query",
  description: `Execute a read-only SQL query. Tables: users, items, scenarios,
    conversations, conversation_turns, user_preferences.
    The 'ratings' table is NOT accessible (ground truth is hidden).`,
  parameters: Type.Object({
    query: Type.String({ description: "SQL SELECT query" }),
  }),
  execute: async (toolCallId, params, onUpdate, ctx, signal) => {
    // validates query is SELECT-only, blocks access to ratings table
    // returns formatted query results as text
  },
};
```

- Read-only (no INSERT/UPDATE/DELETE — preference updates go through `update_preference`)
- The `ratings` table is excluded to prevent data leakage
- Progressive disclosure: `SELECT name, brand FROM items WHERE catalogue = 'a'` for overview, `SELECT * FROM items WHERE item_id = 3` for details

---

## Conversation Flow (End-to-End)

### Pre-Experiment: Taste Extraction

```
For each of 60 conversations:
  1. LLM reads the full transcript
  2. Extracts structured preference signals
  3. Generates a conversation summary
  4. Persists to SQLite:
     - Preference signals → user_preferences table
     - Summary → conversations.summary column
```

This runs once. After extraction, the `user_preferences` table contains all cold-start data.

### Experiment: Conversation Simulation

```
Input: conversation_id to simulate (e.g., conv 1: seeker s1, scenario 1, catalogue a)

SETUP:
  1. Preference Agent: cold_start
     → load_taste_profile(user_id="s1", exclude_conv_id=1)
     → renders taste profile text → injects into Conversation Agent context

  2. Conversation Agent: initialized with
     → scenario description
     → taste profile (from Preference Agent)
     → basic item metadata: names + categories for items 1-12
     → recall_history tool available (History Agent invoked on demand)

CONVERSATION LOOP:
  For each turn in the original transcript:
    1. Seeker utterance replayed from dataset

    2. Conversation Agent responds:
       → may call catalogue_search, compare_items, sql_query, recall_history
       → recall_history spins up History Agent when the LLM wants historical context
       → generates assistant response

    3. Preference Agent monitors (after the full exchange):
       → reads both the Seeker utterance and the Conversation Agent's response
       → extracts new preference signals from both sides
       → update_preference(...) → persists to SQLite
       → re-renders preference summary → injects updated context for next turn

  After final turn:
    4. Conversation Agent predicts ratings:
       → given full context (transcript + preferences + history + items)
       → outputs {item_id: rating} for all 12 items

OUTPUT:
  results/<conv_id>/
    ├── transcript.json      # full conversation (seeker replayed + agent generated)
    ├── predictions.json     # predicted ratings for all 12 items
    ├── preferences.json     # accumulated preference state
    ├── context_injections/  # what was injected by Pref and History agents
    └── tool_calls.json      # log of all tool calls made
```

---

## TUI: Pi-mono InteractiveMode

The TUI is built on Pi-mono's `InteractiveMode`, which provides a full interactive terminal with streaming output, chat history, and slash commands out of the box. Slash commands are implemented as Pi-mono `PromptTemplate` files (`.md` files in `src/prompts/`).

### Setup

```typescript
import { createAgentSession, InteractiveMode, DefaultResourceLoader } from "@mariozechner/pi-coding-agent";

const loader = new DefaultResourceLoader({
  systemPromptOverride: () => buildConversationAgentPrompt(/* injected context */),
  promptsOverride: (current) => ({
    prompts: [...current.prompts, ...mamcrPromptTemplates],
    diagnostics: current.diagnostics,
  }),
});
await loader.reload();

const { session } = await createAgentSession({
  tools: [],                          // no coding tools
  customTools: mamcrTools,            // our 6 custom tools
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});

const mode = new InteractiveMode(session, {});
await mode.run();
```

### Slash Commands (as PromptTemplates)

```
/list                    - list all 60 conversations with metadata
/simulate <conv_id>      - run one conversation simulation
/batch [--user <id>]     - run all conversations (or all for one user)
/evaluate [<conv_id>]    - compute metrics on results (all or specific)
/taste <user_id>         - inspect a user's taste profile
/item <item_id>          - inspect item metadata
/history <user_id>       - show all conversations for a user
/extract                 - run taste extraction pipeline (pre-experiment)
```

Each slash command is a `.md` file in `src/prompts/` that expands to a full prompt. For example, `simulate.md` triggers the orchestrator to run a full conversation simulation.

### Batch Mode (Headless)

For running all 60 conversations without TUI interaction:

```typescript
import { createAgentSession, runPrintMode } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({ /* ... */ });
await runPrintMode(session, {
  mode: "json",
  initialMessage: "/batch",
});
```

### Display During Simulation

The event stream from Pi-mono provides real-time output:

```
┌─ Simulating: Conv 1 | Seeker: s1 | Scenario: Farm Visit | Catalogue: a ─┐
│                                                                           │
│  [PREF AGENT] Cold start loaded: 12 preference signals from 5 convos    │
│  [HIST AGENT] Relevant history: conv 2 (same catalogue, campus scenario) │
│                                                                           │
│  ── Turn 1 ──────────────────────────────────────────────────────────     │
│  Seeker: "Hi, I need a jacket for a farm visit in the fall"              │
│  [PREF] +explicit: occasion=farm/outdoor, season=fall                    │
│  Agent: "Great! What kind of activities will you be doing..."            │
│  [TOOLS] catalogue_search("outdoor fall jacket", catalogue="a", top_k=4)│
│                                                                           │
│  ── Turn 2 ──────────────────────────────────────────────────────────     │
│  Seeker: "Muddy paths, maybe some rain"                                  │
│  [PREF] +explicit: waterproof=required, durability=important             │
│  Agent: "For rain and mud, you'll want something with..."                │
│                                                                           │
│  ...                                                                     │
│                                                                           │
│  ── Ratings ─────────────────────────────────────────────────────────     │
│  Predicted: [3, 5, 2, 1, 1, 1, 2, 1, 1, 1, 3, 1]                       │
│  Ground truth loaded for evaluation.                                     │
│  MAE: 0.83 | PC: 0.72                                                   │
│                                                                           │
│  Results saved to: results/conv_1/                                       │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Evaluation Strategy

### Direct Comparison with Paper (Table 5)

| Metric | Human Asst. | Best MLLM | Our Target |
|--------|-------------|-----------|------------|
| PC ↑ | 0.636 | 0.083 | > 0.3 |
| MAE ↓ | 0.896 | 1.296 | < 1.1 |
| M-MAE ↓ | 0.849 | 1.491 | < 1.2 |
| MAE[GT=1] ↓ | 0.746 | 0.693 | < 0.75 |
| MAE[GT=5] ↓ | 0.597 | 1.726 | < 1.0 |

### Additional Metrics

- **Generalization gap**: MAE on discussed items vs. undiscussed items
- **Cold-start impact**: Performance with vs. without taste profile
- **History impact**: Performance with vs. without historical context

### Ablation Studies

| Variant | What it tests |
|---------|---------------|
| Full system (3 agents + all tools) | Complete architecture |
| No cold start (empty taste profile) | Value of preference extraction |
| No history agent | Value of historical context |
| No tools (LLM-only conversation) | Value of grounded retrieval |
| Single agent + all tools | Multi-agent vs. single-agent |
| Vanilla MLLM (VOGUE paper approach) | Our baseline replication |

### Comparison Studies

| Study | What to Compare |
|-------|----------------|
| MACRS (SIGIR 2024) | Multi-agent dialogue act planning |
| MACRec | 5-agent task-specific architecture |
| InteRecAgent (Microsoft) | Single-agent + tools baseline |
| iEvaLM-CRS (EMNLP 2023) | LLM user simulator for evaluation |
| VOGUE baselines | GPT-4o-mini, GPT-5-mini, Gemini results |

---

## Implementation Phases

### Phase 1: Project Setup & Data Foundation
- [ ] Initialize TypeScript project (`package.json`, `tsconfig.json`)
- [ ] Install dependencies: `@mariozechner/pi-coding-agent`, `better-sqlite3`, `openai`, `@sinclair/typebox`
- [ ] Implement `src/db/schema.ts` — SQLite table creation
- [ ] Implement `src/db/loader.ts` — CSV/JSON → SQLite (replaces `vogue_loader.py`)
- [ ] Compute text embeddings for all 36 items via OpenAI `text-embedding-3-small`, store in `item_embeddings`
- [ ] Implement `src/eval/metrics.ts` — MAE, Pearson correlation, M-MAE, MAE[GT=k]
- [ ] Implement all 6 tools as `ToolDefinition` objects in `src/tools/`

### Phase 2: Taste Extraction Pipeline
- [ ] Implement `src/extract.ts` — taste extraction prompt (LLM reads transcript → preference signals)
- [ ] Implement conversation summarization (summary → `conversations.summary` column)
- [ ] Run extraction on all 60 conversations, populate `user_preferences` + `conversations.summary`

### Phase 3: Multi-Agent Core
- [ ] Implement `src/agents/preference-agent.ts` — separate `createAgentSession()` for cold start + live monitoring
- [ ] Implement `src/agents/history-agent.ts` — separate `createAgentSession()` for historical context
- [ ] Implement `src/agents/conversation-agent.ts` — main session with custom system prompt + 3 tools
- [ ] Implement `src/orchestrator.ts` — coordinates agents per simulation turn:
  - Pre-loop: run Preference Agent (cold start) → inject taste profile into Conversation Agent context
  - Per-turn: replay Seeker utterance → Conversation Agent responds (may call recall_history) → Preference Agent monitors the full exchange → injects updated preferences for next turn
  - Post-loop: Conversation Agent predicts ratings
- [ ] Implement rating prediction prompt (after final turn)

### Phase 4: TUI & Evaluation
- [ ] Create prompt templates in `src/prompts/` for each slash command
- [ ] Implement `src/index.ts` — entry point with `InteractiveMode` setup
- [ ] Wire up `runPrintMode` for headless batch execution
- [ ] Results output pipeline (transcript, predictions, preferences, tool logs → `results/<conv_id>/`)
- [ ] Full evaluation against VOGUE ground truth (60 conversations)
- [ ] Ablation runs (no cold start, no history, no tools, single agent, vanilla MLLM)
- [ ] Metric computation and comparison tables

---

## Resolved Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Pi-mono SDK is TS-native; TUI, tools, sessions all come free |
| Agent framework | Pi-mono SDK | InteractiveMode TUI, ToolDefinition, multi-model, session mgmt — all built-in |
| User simulation | Replay human Seeker utterances | Clean evaluation — same inputs, controlled comparison |
| Same-catalogue history | Allowed (not contamination) | Realistic — a stylist who's worked with you before remembers your preferences |
| Image handling | Multimodal (MLLM reads item images) | The LLM backbone is a multimodal model — item images are provided alongside text metadata for richer understanding |
| Storage format | SQLite (`better-sqlite3`) | Surgical exclusion queries, progressive disclosure, single file |
| Rating prediction | LLM predicts directly | The LLM IS the prediction model, no separate function |
| Preference persistence | Direct to SQLite | `update_preference` writes to DB; builds durable taste profiles |
| Agent structure | 3 agents (Preference, History, Conversation) | Decouples concerns; each is a separate `createAgentSession()` |
| Metadata rendering | Built into each tool's return value | Not a separate qmd tool; formatting is an implementation detail |
| Embedding model | OpenAI `text-embedding-3-small` | Fast, cheap, sufficient for 36-item brute-force search |
| LLM backbone | Multi-provider via Pi-mono `ModelRegistry` | Swap models per ablation: `getModel("anthropic", "claude-sonnet-4-6")` etc. |
| TUI vs GUI | TUI via Pi-mono `InteractiveMode` | Built-in, zero UI code needed; `runPrintMode` for batch |

## Open Questions

1. **Taste extraction quality**: How to validate that extracted preferences are accurate before running experiments?
