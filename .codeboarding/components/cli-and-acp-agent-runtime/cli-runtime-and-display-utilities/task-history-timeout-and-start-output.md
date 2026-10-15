---
component_id: 2.2.6
component_name: Task History, Timeout & Start Output
---

# Task History, Timeout & Start Output

## Component Description

Tracks task execution history, manages task timeouts, and emits task start output notifications.

---

## Key References:

### /Users/highlands/pools/Development/dirac/cli/src/utils/task-start-output.ts (lines 1-8)
```
export function emitTaskStartedMessage(taskId: string, jsonOutput: boolean): void {
	if (jsonOutput) {
		process.stdout.write(JSON.stringify({ type: "task_started", taskId }) + "\n")
		return
	}

	process.stderr.write(`Task started: ${taskId}\n`)
}
```


## Source Files:

- `cli/src/utils/task-history.ts`
- `cli/src/utils/task-start-output.ts`
- `cli/src/utils/task-timeout.ts`

