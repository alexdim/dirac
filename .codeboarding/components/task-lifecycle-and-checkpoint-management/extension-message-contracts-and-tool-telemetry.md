---
component_id: 10.3
component_name: Extension Message Contracts & Tool Telemetry
---

# Extension Message Contracts & Tool Telemetry

## Component Description

Defines shared extension UI message stream and card contracts along with tool execution telemetry helpers.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/ExtensionMessage.ts (lines 291-294)
```
export interface ICardHandle extends ICardHandleBase {
	/** Transitions the card to a final state and resolves any pending interaction */
	finalize(status: CardStatus, doNotAutoCollapse?: boolean): Promise<void>
}
```

### /Users/highlands/pools/Development/dirac/src/shared/ExtensionMessage.ts (lines 261-272)
```
export interface ITextStreamHandle {
	/** The unique ID of the message being streamed */
	readonly id: string
	/** Appends a chunk of text to the message */
	append(chunk: string): Promise<void>
	/** Sets images for the message */
	setImages(images: string[]): Promise<void>
	/** Sets files for the message */
	setFiles(files: string[]): Promise<void>
	/** Marks the stream as complete */
	close(): Promise<void>
}
```

### /Users/highlands/pools/Development/dirac/src/shared/ExtensionMessage.ts (lines 521-529)
```
export function isFinalStatus(status: CardStatus): boolean {
	return (
		status === CardStatus.SUCCESS ||
		status === CardStatus.ERROR ||
		status === CardStatus.SKIPPED ||
		status === CardStatus.CANCELLED ||
		status === CardStatus.ABANDONED
	)
}
```


## Source Files:

- `src/services/telemetry/ToolTelemetry.ts`
- `src/shared/ExtensionMessage.ts`

