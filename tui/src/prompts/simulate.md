---
description: Run a conversation simulation for a specific conversation ID
---
Run a full conversation simulation for conversation $1.

This will:
1. Load the conversation metadata from the database
2. Run the Preference Agent cold start to build a taste profile
3. Replay each seeker utterance through the Conversation Agent
4. Monitor each exchange with the Preference Agent
5. Generate rating predictions after the final turn
6. Save results to results/conv_$1/

Call the simulate_conversation function with conversation ID $1.
