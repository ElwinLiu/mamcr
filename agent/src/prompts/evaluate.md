---
description: Compute evaluation metrics on simulation results
---
Evaluate the simulation results. $ARGUMENTS

If a conversation ID is provided, evaluate just that conversation.
Otherwise, evaluate all conversations that have results.

Compute MAE, Pearson Correlation (PC), Accuracy, M-MAE, and MAE[GT=k] metrics.
Compare against the VOGUE paper baselines:
- Human Assistants: MAE=0.896, PC=0.636, M-MAE=0.849
- Best MLLM (GPT-5-mini): MAE=1.296, PC=0.083, M-MAE=1.543

Call the evaluate function to compute and display metrics.
