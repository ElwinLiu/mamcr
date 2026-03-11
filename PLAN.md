# MAMCR: Multi-Agent Multimodal Conversational Recommendation

## Overview

Build a multi-agent system on the VOGUE dataset to test LLM frameworks' ability in Conversational Recommendation (CR). The system actively conducts conversations (playing the Assistant role) rather than passively rating after reading transcripts.

---

## Background: VOGUE Dataset

- **60 human-human dialogues** across 6 fashion shopping scenarios
- **12 items per conversation** with images + JSON metadata (name, brand, description, features, reviews)
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

### Paper's Evaluation Metrics

| Metric | Formula | Measures |
|--------|---------|----------|
| **MAE** | (1/n) Σ \|r̂_i - r_i\| | Magnitude accuracy (lower is better) |
| **PC** | pearson(r̂, r) on centered vectors | Ranking/directional accuracy (higher is better) |
| **Accuracy** | % exact rating matches | Raw match rate |
| **MAE[GT=k]** | MAE filtered to items where ground truth = k | Per-class error (exposes calibration issues) |
| **M-MAE** | Macro-averaged MAE across rating classes | Class-balanced error |
| **Likert (1-5)** | Post-conversation satisfaction survey | Subjective user experience |

### Paper's Baseline Results (Table 5)

| Model | Accuracy ↑ | PC ↑ | MAE ↓ | M-MAE ↓ |
|-------|-----------|------|-------|---------|
| Human Assistants | 0.397 | **0.636** | **0.896** | **0.849** |
| GPT-5-mini | 0.344 | 0.083 | 1.296 | 1.543 |
| GPT-4o-mini | 0.156 | 0.000 | 1.619 | 1.491 |
| Gemini-2.5-Flash | **0.406** | 0.057 | 1.356 | 1.681 |
| Gemini-2.0-Flash | 0.402 | 0.041 | 1.356 | 1.772 |
| Baseline: Mode Rating | 0.443 | NaN | 1.219 | 1.932 |

**Key insight**: No MLLM was competitive with human Assistants. Mode Rating (predict all 1s) beats all MLLMs on raw accuracy due to class imbalance.

---

## Proposed Multi-Agent Architecture

### Agent Roles

```
┌─────────────────────────────────────────────────────────┐
│                   ORCHESTRATOR AGENT                     │
│                                                          │
│  Controls conversation flow through 5 stages             │
│  Decides which specialist agent to invoke next           │
│  Maintains stage awareness (what stage are we in?)       │
└────────────┬────────────────────────────┬───────────────┘
             │                            │
     ┌───────▼────────┐          ┌───────▼────────┐
     │  ELICITOR       │          │  RECOMMENDER    │
     │  AGENT          │          │  AGENT          │
     │                 │          │                 │
     │ Stages 1, 3     │          │ Stages 2, 4     │
     │ Asks questions   │          │ Selects items   │
     │ Handles critique │          │ Explains choices│
     │ Extracts prefs   │          │ Refines set     │
     └───────┬─────────┘          └───────┬─────────┘
             │                            │
     ┌───────▼────────────────────────────▼───────────┐
     │              PREFERENCE MODEL AGENT             │
     │                                                  │
     │  Maintains a living user preference profile      │
     │  Updates after every turn                        │
     │  Infers preferences for UNDISCUSSED items        │
     │  (addresses generalization problem)              │
     └───────┬────────────────────────────┬────────────┘
             │                            │
             │         TOOL CALLS         │
             ▼                            ▼
┌──────────────────┐  ┌──────────────────────────────┐
│ CATALOGUE SEARCH │  │ PREFERENCE TRANSFER           │
│                  │  │                               │
│ • Embedding      │  │ • "Seeker likes Item 3        │
│   similarity     │  │   (waterproof, rugged)        │
│   over items     │  │   → Item 7 is also            │
│ • Filter by      │  │   waterproof → predict        │
│   attributes     │  │   high rating for Item 7"     │
│ • Metadata       │  │                               │
│   processing     │  │ • Uses item embeddings to     │
│                  │  │   find attribute overlap       │
└──────────────────┘  └──────────────────────────────┘
```

### Agent Descriptions

#### 1. Orchestrator Agent
- **Role**: Stage-aware dialogue manager
- **Input**: Current conversation history, current stage, available agents
- **Behavior**:
  - Tracks which of the 5 stages the conversation is in
  - Routes to Elicitor (Stages 1, 3) or Recommender (Stages 2, 4)
  - Detects stage transitions using intent tag patterns from VOGUE
  - Triggers final agreement (Stage 5) when convergence detected
- **Stage transition signals**:
  - Stage 1→2: Sufficient preference constraints gathered
  - Stage 2→3: Items presented, Seeker begins critiquing
  - Stage 3→4: Critique feedback collected, ready to refine
  - Stage 4→5: Seeker shows acceptance signals
  - Stage 5: Seeker confirms final choice

#### 2. Elicitor Agent
- **Role**: Preference extraction specialist
- **Active in**: Stage 1 (initial elicitation), Stage 3 (critique handling)
- **Behavior**:
  - Stage 1: Asks open-ended questions about context, needs, constraints
  - Stage 3: Processes Seeker critiques, extracts attribute-level preferences
  - Maps utterances to structured preference signals (explicit/implicit/critique/reject)
- **Tool calls**: Updates Preference Model after each turn

#### 3. Recommender Agent
- **Role**: Item selection and presentation specialist
- **Active in**: Stage 2 (first recommendation wave), Stage 4 (refinement)
- **Behavior**:
  - Stage 2: Presents 2-4 items as a group (matching VOGUE's observed pattern)
  - Stage 4: Narrows to 1-2 items based on critique feedback
  - Explains recommendations grounded in item metadata
  - Supports group/comparative reasoning (a key VOGUE finding)
- **Tool calls**: Embedding search for item retrieval, item comparison

#### 4. Preference Model Agent
- **Role**: Living user model maintainer
- **Behavior**:
  - Accumulates structured preference signals from every turn
  - Maintains both explicit preferences (stated) and implicit preferences (inferred)
  - Generalizes to undiscussed items via embedding similarity
  - Calibrates rating predictions using the known skewed distribution
- **Tool calls**: Preference transfer via embeddings, rating prediction

### Tool Specifications

#### Tool 1: Embedding-Based Catalogue Search
```python
def catalogue_search(query: str, top_k: int = 4) -> list[Item]:
    """
    Embed query and find most similar items from catalogue.
    Uses multimodal embeddings (image + text metadata).

    Args:
        query: Natural language preference description
        top_k: Number of items to return
    Returns:
        Ranked list of matching items with similarity scores
    """
```
- **Embedding model**: Multimodal (e.g., CLIP, or text-only over processed metadata)
- **Index**: 12 items per conversation (small, can be brute-force)
- **Purpose**: Grounded item retrieval instead of LLM hallucination

#### Tool 2: Item Comparison
```python
def compare_items(item_a_id: int, item_b_id: int,
                  attributes: list[str]) -> ComparisonResult:
    """
    Structured comparison between two catalogue items.
    Returns factual attribute-level differences.

    Args:
        item_a_id, item_b_id: Item IDs from catalogue
        attributes: Which attributes to compare
    Returns:
        Structured diff (attribute, item_a_value, item_b_value)
    """
```
- **Purpose**: Gives Stage 3 critique handler grounded facts
- **Source**: Item metadata JSON files

#### Tool 3: Preference Model Update
```python
def update_preference(signal: PreferenceSignal) -> PreferenceModel:
    """
    Update the living preference model with a new signal.

    Signal types:
        explicit: "I need something waterproof"
        implicit: "I like Item 3" (infer attributes from item)
        critique: "Item 5 is too flashy" (negative attribute signal)
        reject: "I don't want Item 2" (strong negative)

    Returns: Updated preference model with attribute weights
    """
```

#### Tool 4: Rating Prediction
```python
def predict_all_ratings(preference_model: PreferenceModel,
                        catalogue: list[Item]) -> dict[int, int]:
    """
    Predict 1-5 ratings for ALL 12 items (including undiscussed).
    Uses preference model + item embeddings for generalization.
    Applies calibration to match expected rating distribution.

    Returns: {item_id: predicted_rating} for all 12 items
    """
```
- **Key**: This addresses the generalization problem — ratings for undiscussed items are inferred via embedding similarity to discussed items with known preference signals

#### Tool 5: Metadata Processor (qmd-style)
```python
def process_metadata(item_id: int, focus: str = "all") -> str:
    """
    Convert raw item JSON metadata into clean, focused markdown.
    Reduces token usage and highlights relevant attributes.

    Args:
        item_id: Item to process
        focus: "all" | "materials" | "style" | "durability" | etc.
    Returns:
        Clean markdown summary of item
    """
```
- **Inspiration**: qmd (https://github.com/tobi/qmd) approach of converting content to LLM-friendly format

---

## Conversation Flow (End-to-End)

```
Seeker: "Hi, I need a jacket for a farm visit in the fall"
                    │
                    ▼
        ┌─ Orchestrator: Stage 1, route to Elicitor ─┐
        │                                              │
        │  Elicitor Agent:                             │
        │  → Tool: update_preference(explicit,         │
        │          "farm, fall, outdoor, practical")    │
        │  → Generates: "What kind of terrain will     │
        │    you be walking on?"                       │
        │                                              │
        └──────────────────────────────────────────────┘
                    │
Seeker: "Muddy paths, maybe some rain"
                    │
                    ▼
        ┌─ Orchestrator: Still Stage 1 ────────────────┐
        │                                              │
        │  Elicitor Agent:                             │
        │  → Tool: update_preference(explicit,         │
        │          "waterproof, mud-resistant")         │
        │  → "Do you prefer style or pure function?"   │
        │                                              │
        └──────────────────────────────────────────────┘
                    │
Seeker: "A bit of both, something photo-worthy"
                    │
                    ▼
        ┌─ Orchestrator: Transition to Stage 2 ────────┐
        │                                              │
        │  Recommender Agent:                          │
        │  → Tool: catalogue_search("waterproof        │
        │          stylish outdoor fall jacket")        │
        │  → Tool: process_metadata(items [3,7,11])    │
        │  → "Take a look at Items 3, 7, and 11.       │
        │     Item 3 is a waterproof waxed jacket..."  │
        │                                              │
        └──────────────────────────────────────────────┘
                    │
Seeker: "Item 3 looks good but Item 7 seems too bulky"
                    │
                    ▼
        ┌─ Orchestrator: Stage 3 (Critique) ───────────┐
        │                                              │
        │  Elicitor Agent:                             │
        │  → Tool: update_preference(implicit_pos,     │
        │          item=3, "likes style")              │
        │  → Tool: update_preference(critique,         │
        │          item=7, "too bulky, wants slim fit") │
        │  → Tool: compare_items(3, 11, ["weight",     │
        │          "waterproof", "style"])              │
        │  → "Item 3 is lighter than 11. Would you     │
        │     prefer more warmth or more mobility?"    │
        │                                              │
        └──────────────────────────────────────────────┘
                    │
                  (... continues through Stages 4-5 ...)
                    │
                    ▼
        ┌─ Final: Predict ratings for ALL 12 items ────┐
        │                                              │
        │  Preference Model Agent:                     │
        │  → Tool: predict_all_ratings(pref_model,     │
        │          full_catalogue)                     │
        │  → Output: [5, 1, 4, 1, 1, 1, 2, 1, 1, 1,  │
        │            1, 1]                             │
        │                                              │
        └──────────────────────────────────────────────┘
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

### Additional Metrics (Beyond Paper)

- **Stage transition accuracy**: Do our agents follow realistic 5-stage progressions?
- **Intent tag distribution**: Does our agent's dialogue act distribution match human Assistants'?
- **Conversation efficiency**: Turns to reach final agreement vs. human average (14.8)
- **Generalization gap**: MAE on discussed items vs. undiscussed items (the core weakness)

### Comparison Studies

| Study | What to Compare |
|-------|----------------|
| MACRS (SIGIR 2024) | Multi-agent dialogue act planning |
| MACRec | 5-agent task-specific architecture |
| InteRecAgent (Microsoft) | Single-agent + tools baseline |
| iEvaLM-CRS (EMNLP 2023) | LLM user simulator for evaluation |
| VOGUE baselines | GPT-4o-mini, GPT-5-mini, Gemini results |

---

## Implementation Priorities

### Phase 1: Foundation
- [ ] Set up VOGUE dataset loader and evaluation pipeline
- [ ] Implement MAE, PC, M-MAE, MAE[GT=k] metrics
- [ ] Build single-agent baseline (replicate paper's MLLM evaluation)
- [ ] Implement item embedding index (multimodal or text-only)

### Phase 2: Multi-Agent Core
- [ ] Implement Orchestrator with stage awareness
- [ ] Implement Elicitor Agent with preference extraction
- [ ] Implement Recommender Agent with catalogue search tool
- [ ] Implement Preference Model Agent with update/predict tools

### Phase 3: Tools & Optimization
- [ ] Embedding-based catalogue search
- [ ] Item comparison tool
- [ ] Preference transfer for generalization to undiscussed items
- [ ] Rating calibration (match expected distribution)
- [ ] qmd-style metadata processing

### Phase 4: Evaluation & Ablation
- [ ] Run full evaluation against VOGUE ground truth
- [ ] Compare against paper baselines (Table 5)
- [ ] Ablation: multi-agent vs. single-agent + tools vs. vanilla MLLM
- [ ] Ablation: with vs. without embedding search
- [ ] Ablation: with vs. without preference model
- [ ] Stage transition analysis

---

## Open Questions

1. **User simulation**: Since we need a Seeker to converse with, do we use LLM-simulated Seekers (risk: data leakage per iEvaLM critique) or replay human utterances from VOGUE transcripts?
2. **Image handling**: Do we feed actual item images to multimodal agents, or rely on text metadata only? The human Seeker only had images, so a text-only approach changes the comparison.
3. **Profile usage**: The paper's MLLM benchmark doesn't use user profiles. Should we? It would give an unfair advantage but is more realistic for a deployed system.
4. **Which LLM backbone**: GPT-4o, Claude, Gemini, or open-source? Budget and API constraints matter for 60 conversations × multiple agents × multiple turns.
