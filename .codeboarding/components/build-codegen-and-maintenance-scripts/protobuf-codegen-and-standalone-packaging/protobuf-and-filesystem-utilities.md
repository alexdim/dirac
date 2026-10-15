---
component_id: 11.2.3
component_name: Protobuf & Filesystem Utilities
---

# Protobuf & Filesystem Utilities

## Component Description

Provides shared filesystem manipulation and Protocol Buffers type resolution utilities used across codegen and packaging scripts.

---

## Key References:

### /Users/highlands/pools/Development/dirac/scripts/file-utils.mjs (lines 6-9)
```
export async function writeFileWithMkdirs(filePath, content) {
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, content)
}
```

### /Users/highlands/pools/Development/dirac/scripts/file-utils.mjs (lines 11-13)
```
export async function rmrf(path) {
	await fs.rm(path, { force: true, recursive: true })
}
```

### /Users/highlands/pools/Development/dirac/scripts/proto-utils.mjs (lines 19-24)
```
export function getFqn(name) {
	if (!typeNameToFQN.has(name)) {
		throw Error(`No FQN for ${name}`)
	}
	return typeNameToFQN.get(name)
}
```


## Source Files:

- `scripts/file-utils.mjs`
- `scripts/proto-shared-utils.mjs`
- `scripts/proto-utils.mjs`

