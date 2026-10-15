---
component_id: 4.1
component_name: VS Code Host Bridge gRPC Services
---

# VS Code Host Bridge gRPC Services

## Component Description

Implements VS Code gRPC host-bridge services and handlers for workspace, window, and diff operations.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge-grpc-service.ts (lines 23-116)
```
export class ServiceRegistry {
	private serviceName: string
	private methodRegistry: Record<string, ServiceMethodHandler> = {}
	private streamingMethodRegistry: Record<string, StreamingMethodHandler> = {}
	private methodMetadata: Record<string, MethodMetadata> = {}

	/**
	 * Create a new service registry
	 * @param serviceName The name of the service (used for logging)
	 */
	constructor(serviceName: string) {
		this.serviceName = serviceName
	}

	/**
	 * Register a method handler
	 * @param methodName The name of the method to register
	 * @param handler The handler function for the method
	 * @param metadata Optional metadata about the method
	 */
	registerMethod(methodName: string, handler: ServiceMethodHandler | StreamingMethodHandler, metadata?: MethodMetadata): void {
		const isStreaming = metadata?.isStreaming || false

		if (isStreaming) {
			this.streamingMethodRegistry[methodName] = handler as StreamingMethodHandler
		} else {
			this.methodRegistry[methodName] = handler as ServiceMethodHandler
		}

		this.methodMetadata[methodName] = { isStreaming, ...metadata }
	}

	/**
	 * Check if a method is a streaming method
	 * @param method The method name
	 * @returns True if the method is a streaming method
	 */
	isStreamingMethod(method: string): boolean {
		return this.methodMetadata[method]?.isStreaming || false
	}

	/**
	 * Get a streaming method handler
	 * @param method The method name
	 * @returns The streaming method handler or undefined if not found
	 */
	getStreamingHandler(method: string): StreamingMethodHandler | undefined {
		return this.streamingMethodRegistry[method]
	}

	/**
	 * Handle a service request
	 * @param method The method name
	 * @param message The request message
	 * @returns The response message
	 */
	async dispatchGrpcMethod(method: string, message: any): Promise<any> {
		const handler = this.methodRegistry[method]

		if (!handler) {
			if (this.isStreamingMethod(method)) {
				throw new Error(`Method ${method} is a streaming method and should be handled with handleStreamingRequest`)
			}
			throw new Error(`Unknown ${this.serviceName} method: ${method}`)
		}

		return handler(message)
	}

	/**
	 * Handle a streaming service request
	 * @param method The method name
	 * @param message The request message
	 * @param responseStream The streaming response handler
	 * @param requestId The request ID for correlation and cleanup
	 */
	async handleStreamingRequest(
		method: string,
		message: any,
		responseStream: StreamingResponseHandler,
		requestId?: string,
	): Promise<void> {
		const handler = this.streamingMethodRegistry[method]

		if (!handler) {
			if (this.methodRegistry[method]) {
				throw new Error(`Method ${method} is not a streaming method and should be handled with dispatchGrpcMethod`)
			}
			throw new Error(`Unknown ${this.serviceName} streaming method: ${method}`)
		}

		await handler(message, responseStream, requestId)
	}
}
```

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/workspace/executeCommandInTerminal.ts (lines 11-42)
```
export async function executeCommandInTerminal(
	request: ExecuteCommandInTerminalRequest,
): Promise<ExecuteCommandInTerminalResponse> {
	try {
		// Create terminal with fixed options
		const terminalOptions: vscode.TerminalOptions = {
			name: "Dirac",
			iconPath: getDiracIconUri(),
			env: {
				DIRAC_ACTIVE: "true",
			},
		}

		// Create a new terminal
		const terminal = vscode.window.createTerminal(terminalOptions)

		// Show the terminal to the user
		terminal.show()

		// Send the command to the terminal
		terminal.sendText(request.command, true)

		return ExecuteCommandInTerminalResponse.create({
			success: true,
		})
	} catch (error) {
		Logger.error("Error executing command in terminal:", error)
		return ExecuteCommandInTerminalResponse.create({
			success: false,
		})
	}
}
```


## Source Files:

- `src/hosts/vscode/hostbridge-grpc-handler.ts`
- `src/hosts/vscode/hostbridge-grpc-service.ts`
- `src/hosts/vscode/hostbridge/client/host-grpc-client-base.ts`
- `src/hosts/vscode/hostbridge/diff/closeAllDiffs.ts`
- `src/hosts/vscode/hostbridge/diff/getDocumentText.ts`
- `src/hosts/vscode/hostbridge/diff/openDiff.ts`
- `src/hosts/vscode/hostbridge/diff/openMultiFileDiff.ts`
- `src/hosts/vscode/hostbridge/diff/replaceText.ts`
- `src/hosts/vscode/hostbridge/diff/saveDocument.ts`
- `src/hosts/vscode/hostbridge/diff/scrollDiff.ts`
- `src/hosts/vscode/hostbridge/diff/truncateDocument.ts`
- `src/hosts/vscode/hostbridge/testing/getWebviewHtml.ts`
- `src/hosts/vscode/hostbridge/window/getActiveEditor.ts`
- `src/hosts/vscode/hostbridge/window/getOpenTabs.ts`
- `src/hosts/vscode/hostbridge/window/getVisibleTabs.ts`
- `src/hosts/vscode/hostbridge/window/openFile.ts`
- `src/hosts/vscode/hostbridge/window/openSettings.ts`
- `src/hosts/vscode/hostbridge/window/showInputBox.ts`
- `src/hosts/vscode/hostbridge/window/showMessage.ts`
- `src/hosts/vscode/hostbridge/window/showOpenDialogue.ts`
- `src/hosts/vscode/hostbridge/window/showSaveDialog.ts`
- `src/hosts/vscode/hostbridge/window/showTextDocument.ts`
- `src/hosts/vscode/hostbridge/workspace/executeCommandInTerminal.ts`
- `src/hosts/vscode/hostbridge/workspace/openDiracSidebarPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/openFolder.ts`
- `src/hosts/vscode/hostbridge/workspace/openInFileExplorerPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/openProblemsPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/openTerminalPanel.ts`
- `src/hosts/vscode/hostbridge/workspace/prepareDiagnostics.ts`

