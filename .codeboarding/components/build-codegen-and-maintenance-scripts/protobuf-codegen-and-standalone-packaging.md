---
component_id: 11.2
component_name: Protobuf Codegen & Standalone Packaging
---

# Protobuf Codegen & Standalone Packaging

## Component Description

Generates Protocol Buffer definitions, host-bridge and protobus client/setup bindings, and standalone distribution packages.

---

## Key References:

### /Users/highlands/pools/Development/dirac/scripts/proto-utils.mjs (lines 26-30)
```
export async function getPackageDefinition() {
	const descriptorBuffer = await fs.readFile(DESCRIPTOR_SET)
	const options = { longs: Number } // Encode int64 fields as numbers
	return protoLoader.loadFileDescriptorSetFromBuffer(descriptorBuffer, options)
}
```


## Source Files:

- `scripts/build-proto.mjs`
- `scripts/build-python-proto.mjs`
- `scripts/build-tests.js`
- `scripts/file-utils.mjs`
- `scripts/generate-host-bridge-client.mjs`
- `scripts/generate-protobus-setup.mjs`
- `scripts/generate-state-proto.mjs`
- `scripts/package-npm.mjs`
- `scripts/package-standalone.mjs`
- `scripts/proto-shared-utils.mjs`
- `scripts/proto-utils.mjs`

