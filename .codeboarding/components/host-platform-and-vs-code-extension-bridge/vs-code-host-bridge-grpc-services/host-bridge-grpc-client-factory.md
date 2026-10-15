---
component_id: 4.1.5
component_name: Host Bridge gRPC Client Factory
---

# Host Bridge gRPC Client Factory

## Component Description

Constructs typed gRPC clients from protobuf service definitions that route unary and streaming calls through the host bridge gRPC handler.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/hosts/vscode/hostbridge/client/host-grpc-client-base.ts (lines 34-96)
```
export function createGrpcClient<T extends ProtoService>(service: T): GrpcClientType<T> {
	const client: Record<string, Function> = {}
	const grpcHandler = new GrpcHandler()

	Object.values(service.methods).forEach((method) => {
		// Use lowercase method name as the key in the client object
		const methodKey = method.name.charAt(0).toLowerCase() + method.name.slice(1)

		// Streaming method implementation
		if (method.responseStream) {
			client[methodKey] = (request: any, options: StreamingCallbacks<InstanceType<typeof method.responseType>>) => {
				// Use dispatchGrpcMethod with streaming callbacks
				const requestId = uuidv4()

				// We need to await the promise and then return the cancel function
				return (async () => {
					try {
						const result = await grpcHandler.dispatchGrpcMethod<InstanceType<typeof method.responseType>>(
							service.fullName,
							methodKey,
							request,
							requestId,
							options,
						)

						// If the result is a function, it's the cancel function
						if (typeof result === "function") {
							return result
						}
						// This shouldn't happen, but just in case
						Logger.error(`Expected cancel function but got response object for streaming request: ${requestId}`)
						return () => {}
					} catch (error) {
						Logger.error(`Error in streaming request: ${error}`)
						if (options.onError) {
							options.onError(toError(error))
						}
						return () => {}
					}
				})()
			}
		} else {
			// Unary method implementation
			client[methodKey] = async (request: any) => {
				const requestId = uuidv4()
				try {
					const response = await grpcHandler.dispatchGrpcMethod(service.fullName, methodKey, request, requestId)

					// Check if the response is a function (streaming)
					if (typeof response === "function") {
						// This shouldn't happen for unary requests
						throw new Error("Received streaming response for unary request")
					}
					return response
				} catch (e) {
					Logger.log(`[DEBUG] gRPC host ERR to ${service.fullName}.${methodKey} req:${requestId} err:${e}`)
					throw e
				}
			}
		}
	})
	return client as GrpcClientType<T>
}
```


## Source Files:

- `src/hosts/vscode/hostbridge/client/host-grpc-client-base.ts`

