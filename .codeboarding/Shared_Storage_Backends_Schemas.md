```mermaid
graph LR
    Storage_Backends_Environment_Adapters["Storage Backends & Environment Adapters"]
    State_Provider_Key_Definitions["State & Provider Key Definitions"]
    Storage_Backends_Environment_Adapters -- "resolves provider settings and secret keys from" --> State_Provider_Key_Definitions
```

[![CodeBoarding](https://img.shields.io/badge/Generated%20by-CodeBoarding-9cf?style=flat-square)](https://github.com/CodeBoarding/CodeBoarding)[![Web platform](https://img.shields.io/badge/Open%20in-Web%20platform-2563EB?style=flat-square)](https://app.codeboarding.org)[![Demo](https://img.shields.io/badge/Try%20our-Demo-blue?style=flat-square)](https://www.codeboarding.org/diagrams)[![Contact](https://img.shields.io/badge/Contact%20us%20-%20contact@codeboarding.org-lightgrey?style=flat-square)](mailto:contact@codeboarding.org)

## Details

Provides low-level file and blob storage implementations, state and provider key definitions, environment configuration loaders, and legacy model ID migrations.

### Storage Backends & Environment Adapters
Provides file, blob, and in-memory storage implementations, storage context initialization, environment variable configuration resolvers, and message content format adapters.


**Related Classes/Methods**:

- `src.shared.storage.DiracStorage.DiracStorage`:34-113
- `src.shared.storage.DiracStorage.DiracSyncStorage`:127-212
- `src.shared.storage.storage-context.createStorageContext`:94-126
- `src.shared.storage.env-config.getExplicitDiracSettingsFromEnv`:71-88



**Source Files:**

- `src/shared/messages/content.ts`
  - `src.shared.messages.content.DiracReasoningDetailParam` (L8-L14) - Interface
  - `src.shared.messages.content.DiracSharedMessageParam` (L16-L19) - Interface
  - `src.shared.messages.content.DiracTextContentBlock` (L28-L38) - Interface
  - `src.shared.messages.content.DiracImageContentBlock` (L40-L40) - Interface
  - `src.shared.messages.content.DiracDocumentContentBlock` (L42-L42) - Interface
  - `src.shared.messages.content.DiracUserToolResultContentBlock` (L44-L44) - Interface
  - `src.shared.messages.content.DiracAssistantToolUseBlock` (L49-L54) - Interface
  - `src.shared.messages.content.DiracAssistantThinkingBlock` (L56-L60) - Interface
  - `src.shared.messages.content.DiracAssistantRedactedThinkingBlock` (L62-L62) - Interface
  - `src.shared.messages.content.DiracStorageMessage` (L88-L110) - Interface
  - `src.shared.messages.content.removeUserInputMarkersFromContent` (L112-L132) - Function
  - `src.shared.messages.content.removeUserInputMarkersFromContent.content.block.content.map() callback` (L117-L117) - Function
  - `src.shared.messages.content.removeUserInputMarkersFromContent.source.content.block.source.content.map() callback` (L125-L126) - Function
  - `src.shared.messages.content.removeUserInputMarkersFromMessage` (L134-L137) - Function
  - `src.shared.messages.content.removeProviderBoundaryMetadataFromMessage` (L139-L142) - Function
  - `src.shared.messages.content.convertDiracStorageToAnthropicMessage` (L144-L158) - Function
  - `src.shared.messages.content.convertDiracStorageToAnthropicMessage.filteredContent` (L152-L152) - Class
  - `src.shared.messages.content.convertDiracStorageToAnthropicMessage.filteredContent.content.filter() callback` (L152-L152) - Function
  - `src.shared.messages.content.removeProviderBoundaryMetadata` (L160-L181) - Function
  - `src.shared.messages.content.removeProviderBoundaryMetadata.content.block.content.map() callback` (L168-L168) - Function
  - `src.shared.messages.content.removeProviderBoundaryMetadata.source.content.block.source.content.map() callback` (L176-L176) - Function
  - `src.shared.messages.content.cleanContentBlock` (L183-L198) - Function
  - `src.shared.messages.content.cleanContentBlock.block.content.map() callback` (L188-L188) - Function
  - `src.shared.messages.content.cleanContentBlock.content.block.source.content.map() callback` (L193-L193) - Function
- `src/shared/storage/DiracBlobStorage.ts`
  - `src.shared.storage.DiracBlobStorage.BlobStoreSettings` (L5-L26) - Interface
  - `src.shared.storage.DiracBlobStorage.DiracBlobStorage` (L32-L146) - Class
  - `src.shared.storage.DiracBlobStorage.DiracBlobStorage.instance` (L36-L41) - Method
  - `src.shared.storage.DiracBlobStorage.DiracBlobStorage.init` (L51-L87) - Method
  - `src.shared.storage.DiracBlobStorage.DiracBlobStorage.isReady` (L92-L94) - Method
  - `src.shared.storage.DiracBlobStorage.DiracBlobStorage.isConfigured` (L96-L109) - Method
  - `src.shared.storage.DiracBlobStorage.DiracBlobStorage._get` (L111-L121) - Method
  - `src.shared.storage.DiracBlobStorage.DiracBlobStorage._store` (L123-L133) - Method
  - `src.shared.storage.DiracBlobStorage.DiracBlobStorage._delete` (L135-L145) - Method
- `src/shared/storage/DiracFileStorage.ts`
  - `src.shared.storage.DiracFileStorage.DiracFileStorageOptions` (L6-L12) - Interface
  - `src.shared.storage.DiracFileStorage.DiracFileStorage` (L19-L102) - Class
  - `src.shared.storage.DiracFileStorage.DiracFileStorage.constructor` (L25-L31) - Constructor
  - `src.shared.storage.DiracFileStorage.DiracFileStorage.reloadFromDisk` (L34-L36) - Method
  - `src.shared.storage.DiracFileStorage.DiracFileStorage._get` (L38-L40) - Method
  - `src.shared.storage.DiracFileStorage.DiracFileStorage._set` (L42-L45) - Method
  - `src.shared.storage.DiracFileStorage.DiracFileStorage._delete` (L47-L49) - Method
  - `src.shared.storage.DiracFileStorage.DiracFileStorage.setBatch` (L56-L76) - Method
  - `src.shared.storage.DiracFileStorage.DiracFileStorage._keys` (L78-L80) - Method
  - `src.shared.storage.DiracFileStorage.DiracFileStorage.readFromDisk` (L82-L91) - Method
  - `src.shared.storage.DiracFileStorage.DiracFileStorage.writeToDisk` (L93-L101) - Method
  - `src.shared.storage.DiracFileStorage.atomicWriteFileSync` (L108-L127) - Function
- `src/shared/storage/DiracStorage.ts`
  - `src.shared.storage.DiracStorage.DiracStorageChangeEvent` (L3-L5) - Interface
  - `src.shared.storage.DiracStorage.DiracMemento` (L17-L27) - Interface
  - `src.shared.storage.DiracStorage.get` (L18-L18) - Method
  - `src.shared.storage.DiracStorage.DiracMemento.get` (L19-L19) - Method
  - `src.shared.storage.DiracStorage.DiracMemento.update` (L20-L20) - Method
  - `src.shared.storage.DiracStorage.DiracMemento.keys` (L21-L21) - Method
  - `src.shared.storage.DiracStorage.DiracMemento.setBatch` (L26-L26) - Method
  - `src.shared.storage.DiracStorage.DiracStorage` (L34-L113) - Class
  - `src.shared.storage.DiracStorage.DiracStorage.onDidChange` (L47-L55) - Method
  - `src.shared.storage.DiracStorage.DiracStorage.onDidChange.<function>` (L49-L54) - Function
  - `src.shared.storage.DiracStorage.DiracStorage.get` (L61-L67) - Method
  - `src.shared.storage.DiracStorage.DiracStorage._dangerousStore` (L69-L71) - Method
  - `src.shared.storage.DiracStorage.DiracStorage.store` (L78-L84) - Method
  - `src.shared.storage.DiracStorage.DiracStorage.delete` (L91-L97) - Method
  - `src.shared.storage.DiracStorage.DiracStorage._get` (L102-L102) - Method
  - `src.shared.storage.DiracStorage.DiracStorage._store` (L107-L107) - Method
  - `src.shared.storage.DiracStorage.DiracStorage._delete` (L112-L112) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage` (L127-L212) - Class
  - `src.shared.storage.DiracStorage.DiracSyncStorage.onDidChange` (L138-L146) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage.onDidChange.<function>` (L140-L145) - Function
  - `src.shared.storage.DiracStorage.DiracSyncStorage.fireChange` (L151-L159) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage.get` (L163-L171) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage.update` (L176-L179) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage.set` (L181-L188) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage.delete` (L190-L197) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage.keys` (L199-L206) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage._get` (L208-L208) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage._set` (L209-L209) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage._delete` (L210-L210) - Method
  - `src.shared.storage.DiracStorage.DiracSyncStorage._keys` (L211-L211) - Method
  - `src.shared.storage.DiracStorage.DiracInMemoryStorage` (L217-L234) - Class
  - `src.shared.storage.DiracStorage.DiracInMemoryStorage._get` (L223-L225) - Method
  - `src.shared.storage.DiracStorage.DiracInMemoryStorage._store` (L227-L229) - Method
  - `src.shared.storage.DiracStorage.DiracInMemoryStorage._delete` (L231-L233) - Method
- `src/shared/storage/adapters.ts`
  - `src.shared.storage.adapters.StorageAdapter` (L5-L9) - Interface
  - `src.shared.storage.adapters.StorageAdapter.read` (L6-L6) - Method
  - `src.shared.storage.adapters.StorageAdapter.write` (L7-L7) - Method
  - `src.shared.storage.adapters.StorageAdapter.remove` (L8-L8) - Method
  - `src.shared.storage.adapters.createAdapter` (L11-L48) - Function
  - `src.shared.storage.adapters.createAdapter.read` (L14-L23) - Method
  - `src.shared.storage.adapters.createAdapter.write` (L25-L36) - Method
  - `src.shared.storage.adapters.createAdapter.remove` (L38-L46) - Method
  - `src.shared.storage.adapters.createS3Adapter` (L50-L71) - Function
  - `src.shared.storage.adapters.createR2Adapter` (L73-L92) - Function
  - `src.shared.storage.adapters.getStorageAdapter` (L94-L109) - Function
- `src/shared/storage/env-config.ts`
  - `src.shared.storage.env-config.getExplicitDiracProviderFromEnv` (L58-L61) - Function
  - `src.shared.storage.env-config.getExplicitDiracSecretsFromEnv` (L63-L69) - Function
  - `src.shared.storage.env-config.getExplicitDiracSettingsFromEnv` (L71-L88) - Function
  - `src.shared.storage.env-config.getSecretsFromEnv` (L94-L118) - Function
  - `src.shared.storage.env-config.getSettingsFromEnv` (L124-L151) - Function
  - `src.shared.storage.env-config.getProviderFromEnv` (L156-L185) - Function
- `src/shared/storage/legacy-model-id-migration.ts`
  - `src.shared.storage.legacy-model-id-migration.normalizeRetiredDeepSeekModelId` (L22-L24) - Function
  - `src.shared.storage.legacy-model-id-migration.normalizeLegacySynthetic1mModelId` (L30-L37) - Function
  - `src.shared.storage.legacy-model-id-migration.normalizeLegacyAnthropicFastModeModelId` (L41-L43) - Function
  - `src.shared.storage.legacy-model-id-migration.buildLegacyAnthropicFastModeStateUpdates` (L45-L59) - Function
  - `src.shared.storage.legacy-model-id-migration.buildLegacyModelIdStateUpdates` (L61-L71) - Function
  - `src.shared.storage.legacy-model-id-migration.buildRetiredDeepSeekModelStateUpdates` (L72-L97) - Function
  - `src.shared.storage.legacy-model-id-migration.normalizeLegacyOpenRouterPinMap` (L98-L115) - Function
  - `src.shared.storage.legacy-model-id-migration.normalizeLegacyOpenRouterPinMap.canonicalKeys` (L105-L105) - Class
  - `src.shared.storage.legacy-model-id-migration.normalizeLegacyOpenRouterPinMap.canonicalKeys.keys.filter() callback` (L105-L105) - Function
  - `src.shared.storage.legacy-model-id-migration.normalizeLegacyOpenRouterPinMap.legacyKeys` (L106-L106) - Class
  - `src.shared.storage.legacy-model-id-migration.normalizeLegacyOpenRouterPinMap.legacyKeys.keys.filter() callback` (L106-L106) - Function
  - `src.shared.storage.legacy-model-id-migration.removeLegacySynthetic1mModelEntries` (L117-L121) - Function
  - `src.shared.storage.legacy-model-id-migration.removeLegacySynthetic1mModelEntries.filter() callback` (L119-L119) - Function
  - `src.shared.storage.legacy-model-id-migration.buildLegacySynthetic1mStateUpdates` (L123-L150) - Function
  - `src.shared.storage.legacy-model-id-migration.normalizeLegacyModelProviderPresets` (L152-L167) - Function
  - `src.shared.storage.legacy-model-id-migration.normalizeLegacyModelProviderPreset` (L169-L187) - Function
- `src/shared/storage/storage-context.ts`
  - `src.shared.storage.storage-context.StorageContext` (L15-L39) - Interface
  - `src.shared.storage.storage-context.StorageContextOptions` (L41-L62) - Interface
  - `src.shared.storage.storage-context.hashString` (L70-L78) - Function
  - `src.shared.storage.storage-context.createStorageContext` (L94-L126) - Function
- `src/shared/storage/types.ts`
  - `src.shared.storage.types.isOpenaiReasoningEffort` (L21-L23) - Function
  - `src.shared.storage.types.normalizeOpenaiReasoningEffort` (L25-L28) - Function
  - `src.shared.storage.types.isInferenceSpeed` (L42-L44) - Function
  - `src.shared.storage.types.normalizeInferenceSpeed` (L46-L49) - Function


### State & Provider Key Definitions
Defines global state, user settings, secret schemas, and provider-specific model and API key mappings.


**Related Classes/Methods**:

- `src.shared.storage.provider-keys.getProviderModelIdKey`:131-141



**Source Files:**

- `src/shared/storage/provider-keys.ts`
  - `src.shared.storage.provider-keys.getProviderModelIdKey` (L131-L141) - Function
  - `src.shared.storage.provider-keys.getProviderModelInfoKey` (L143-L146) - Function
  - `src.shared.storage.provider-keys.getProviderDefaultModelId` (L148-L150) - Function
- `src/shared/storage/state-keys.ts`
  - `src.shared.storage.state-keys.UtilityModelUseCases` (L51-L56) - Interface
  - `src.shared.storage.state-keys.USER_SETTINGS_FIELDS.browserSettings.transform` (L251-L251) - Method
  - `src.shared.storage.state-keys.USER_SETTINGS_FIELDS.autoCondenseContextLimits.transform` (L268-L273) - Method
  - `src.shared.storage.state-keys.USER_SETTINGS_FIELDS.autoCondenseContextLimits.transform.filter() callback` (L271-L271) - Function
  - `src.shared.storage.state-keys.extractDefaults` (L445-L451) - Function
  - `src.shared.storage.state-keys.extractDefaults.map() callback` (L448-L448) - Function
  - `src.shared.storage.state-keys.extractDefaults.filter() callback` (L449-L449) - Function
  - `src.shared.storage.state-keys.extractTransforms` (L453-L459) - Function
  - `src.shared.storage.state-keys.extractTransforms.filter() callback` (L456-L456) - Function
  - `src.shared.storage.state-keys.extractTransforms.map() callback` (L457-L457) - Function
  - `src.shared.storage.state-keys.extractMetadata` (L461-L467) - Function
  - `src.shared.storage.state-keys.extractMetadata.filter() callback` (L464-L464) - Function
  - `src.shared.storage.state-keys.extractMetadata.map() callback` (L465-L465) - Function




### [FAQ](https://github.com/CodeBoarding/GeneratedOnBoardings/tree/main?tab=readme-ov-file#faq)