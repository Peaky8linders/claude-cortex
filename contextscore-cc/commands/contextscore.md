---
description: Score the current context quality and get diagnostics with fixes
---

Run a full context quality analysis on the current session. Execute:

```bash
contextscore score <(echo "$CONTEXT") --query "current task description" 
```

If the score is below 70, pay attention to the diagnosed issues and their recommended fixes. 

For a pre-compaction snapshot, run:
```bash
contextscore snapshot <(echo "$CONTEXT") --session "$SESSION_ID" --query "current task"
```

To recover after compaction:
```bash
contextscore recover
```
