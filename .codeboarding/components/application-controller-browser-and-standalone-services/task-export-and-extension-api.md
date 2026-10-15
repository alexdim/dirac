---
component_id: 5.5
component_name: Task Export & Extension API
---

# Task Export & Extension API

## Component Description

Exposes the public Dirac extension API and exports task conversation histories to markdown.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/core/controller/task/exportTaskWithId.ts (lines 11-22)
```
export async function exportTaskWithId(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		if (request.value) {
			await controller.exportTaskWithId(request.value)
		}
		return Empty.create()
	} catch (error) {
		// Log the error but allow it to propagate for proper gRPC error handling
		Logger.error(`Error exporting task with ID ${request.value}:`, error)
		throw error
	}
}
```

### /Users/highlands/pools/Development/dirac/src/exports/index.ts (lines 26-32)
```
		pressPrimaryButton: async () => {
			if (sidebarController.task) {
				await sidebarController.task.submitCardResponse("", DiracAskResponse.APPROVE)
			} else {
				Logger.error("No active task to press button for")
			}
		},
```


## Source Files:

- `src/core/controller/task/exportTaskWithId.ts`
- `src/exports/dirac.d.ts`
- `src/exports/index.ts`
- `src/integrations/misc/export-markdown.ts`
- `src/services/telemetry/providers/opentelemetry/otel-exporter-diagnostics.ts`
- `src/utils/AnchorStateManager.ts`

