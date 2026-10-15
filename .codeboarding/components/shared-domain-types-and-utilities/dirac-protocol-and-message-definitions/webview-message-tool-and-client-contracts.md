---
component_id: 3.2.1
component_name: Webview Message, Tool & Client Contracts
---

# Webview Message, Tool & Client Contracts

## Component Description

Defines shared webview gRPC message envelopes, Dirac client/API/context contracts, tool definitions, icon identifiers, and message metrics types.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/WebviewMessage.ts (lines 1-5)
```
export interface WebviewMessage {
	type: "grpc_request" | "grpc_request_cancel"
	grpc_request?: GrpcRequest
	grpc_request_cancel?: GrpcCancel
}
```

### /Users/highlands/pools/Development/dirac/src/shared/WebviewMessage.ts (lines 19-26)
```
export enum DiracAskResponse {
	APPROVE = "approve",
	REJECT = "reject",
	MESSAGE = "message",
	EDIT = "edit",
	VIEW = "view",
	UNDO = "undo",
}
```

### /Users/highlands/pools/Development/dirac/src/shared/dirac/index.ts (lines 4-8)
```
export enum DiracClient {
	VSCode = "VSCode Extension",
	JetBrains = "JetBrains",
	Cli = "CLI",
}
```


## Source Files:

- `src/shared/WebviewMessage.ts`
- `src/shared/dirac/api.ts`
- `src/shared/dirac/context.ts`
- `src/shared/dirac/index.ts`
- `src/shared/icons.ts`
- `src/shared/messages/metrics.ts`
- `src/shared/tools.ts`

