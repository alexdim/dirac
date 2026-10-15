---
component_id: 3.2.2
component_name: Account, Billing & Internal Tester Types
---

# Account, Billing & Internal Tester Types

## Component Description

Defines Dirac account, organization, balance, and usage transaction schemas alongside internal tester and bot account classification helpers.

---

## Key References:

### /Users/highlands/pools/Development/dirac/src/shared/DiracAccount.ts (lines 1-17)
```
export interface UserResponse {
	id: string
	email: string
	displayName: string
	photoUrl: string
	createdAt: string
	updatedAt: string
	organizations: [
		{
			active: boolean
			memberId: string
			name: string
			organizationId: string
			roles: ["admin" | "member" | "owner"]
		},
	]
}
```

### /Users/highlands/pools/Development/dirac/src/shared/DiracAccount.ts (lines 19-22)
```
export interface BalanceResponse {
	balance: number
	userId: string
}
```

### /Users/highlands/pools/Development/dirac/src/shared/DiracAccount.ts (lines 24-44)
```
export interface UsageTransaction {
	aiInferenceProviderName: string
	aiModelName: string
	aiModelTypeName: string
	completionTokens: number
	costUsd: number
	createdAt: string
	creditsUsed: number
	generationId: string
	id: string
	metadata: {
		additionalProp1: string
		additionalProp2: string
		additionalProp3: string
	}
	operation?: string
	organizationId: string
	promptTokens: number
	totalTokens: number
	userId: string
}
```

### /Users/highlands/pools/Development/dirac/src/shared/internal/account.ts (lines 14-16)
```
export function isDiracInternalTester(email: string): boolean {
	return isDiracBotUser(email) || DIRAC_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}
```


## Source Files:

- `src/shared/DiracAccount.ts`
- `src/shared/internal/account.ts`

