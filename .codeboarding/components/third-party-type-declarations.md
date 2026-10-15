---
component_id: 14
component_name: Third-Party Type Declarations
---

# Third-Party Type Declarations

## Component Description

Declares ambient TypeScript definitions for third-party glob matching and file locking libraries.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/types/picomatch.d.ts (lines 12-12)
```
	function picomatch(pattern: string | string[], options?: PicomatchOptions): PicomatchMatcher
```

### /Users/highlands/pools/Development/dirac/src/types/proper-lockfile.d.ts (lines 19-19)
```
	export function lock(file: string, options?: LockOptions): Promise<ReleaseLock>
```


## Source Files:

- `src/types/picomatch.d.ts`
- `src/types/proper-lockfile.d.ts`

