---
description: Run taste extraction pipeline on all conversations
---
Run the taste extraction pipeline.

This pre-experiment step processes all 60 conversations to:
1. Extract preference signals from each transcript → user_preferences table
2. Generate conversation summaries → conversations.summary column

Call the extract_all function to run the pipeline.
