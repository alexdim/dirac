import type { UtilityPermissionRequest } from "@core/permissions/UtilityPermissionDecisionService"
import { DiracAskResponse } from "@shared/WebviewMessage"
import { CardStatus } from "@shared/ExtensionMessage"
import type { IUITrait, IInteractionTrait, ICardHandle, CardParams } from "../../interfaces/IToolEnvironment"
import type { TaskConfig } from "../../types/TaskConfig"
import { CardHandle } from "../CardHandle"
import { ApprovedPermissionCardHandle } from "../ApprovedPermissionCardHandle"

// Builds the UI trait — text streaming and card creation.
export function buildUiTrait(config: TaskConfig, createCardFn: (params: CardParams) => Promise<ICardHandle>): IUITrait {
	return {
		createCard: createCardFn,
		upsertText: async (text: string, isReasoning?: boolean, role?: "user" | "assistant") => {
			const visibleText = config.agentIdentity && role !== "user" ? `**${config.agentIdentity.name}:** ${text}` : text
			await config.taskMessenger.upsertText(visibleText, isReasoning, undefined, undefined, role, config.agentIdentity)
		},
		streamText: async (type: "markdown" | "reasoning") => {
			return await config.taskMessenger.streamText(type)
		},
		publishState: async () => await config.callbacks.postStateToWebview(),
	}
}

export function buildInteractionTrait(
	config: TaskConfig,
	createCardFn: (params: CardParams) => Promise<ICardHandle>,
): IInteractionTrait {
	return {
		askPermission: async (message, preview) => {
			const card = await createCardFn({
				header: "Permission Request",
				body: message,
				requireApproval: true,
				permissionRequestKind: preview?.manualOnly ? "manual_tool" : "tool",
				collapsed: false,
				...(preview?.diffs ? { diffs: preview.diffs, renderType: "diff" } : {}),
				...(preview?.rawInput ? { rawInput: preview.rawInput } : {}),
			})
			const result = await card.waitForInteraction()
			return {
				approved: result.action === DiracAskResponse.APPROVE,
				action: result.action,
				value: result.value,
				text: result.text,
				images: result.images as string[] | undefined,
				files: result.files as string[] | undefined,
				userEdits: result.userEdits,
				card,
			}
		},
	}
}

// Resolves explicitly classified tool permissions before falling back to the displayed-card path.
export async function createCardFromMessenger(
	config: TaskConfig,
	params: CardParams,
	tracker: CardHandle[],
): Promise<ICardHandle> {
	const { permissionRequestKind, ...cardParams } = params
	if (permissionRequestKind === undefined) {
		return createDisplayedCardFromMessenger(config, cardParams, tracker)
	}

	const isAutoApproved = () => isUnrestrictedToolApproval(config)
	if (isAutoApproved()) {
		return new ApprovedPermissionCardHandle(cardParams)
	}
	if (permissionRequestKind === "manual_tool") {
		return createDisplayedCardFromMessenger(config, cardParams, tracker, false, isAutoApproved)
	}

	const binding = config.permissionDecisionBinding
	if (!binding) return createDisplayedCardFromMessenger(config, cardParams, tracker, true, isAutoApproved)

	const decision = await binding.service.decide(
		createUtilityPermissionRequest(config, cardParams),
		config.taskState.abortSignal,
	)
	if (isAutoApproved()) {
		return new ApprovedPermissionCardHandle(cardParams)
	}

	const currentBinding = config.permissionDecisionBinding
	if (!currentBinding || currentBinding.configurationRevision !== binding.configurationRevision) {
		return createDisplayedCardFromMessenger(config, cardParams, tracker, true, isAutoApproved)
	}
	if (decision.decision === "escalate") {
		return createDisplayedCardFromMessenger(config, cardParams, tracker, true, isAutoApproved)
	}
	return new ApprovedPermissionCardHandle(cardParams)
}

function isUnrestrictedToolApproval(config: TaskConfig): boolean {
	return config.autoApprover.isUnrestrictedAutoApprove()
}

function createUtilityPermissionRequest(config: TaskConfig, params: CardParams): UtilityPermissionRequest {
	const toolName = config.toolUse?.name ?? params.toolName ?? "unknown"
	const includesResolvedDiffs = toolName === "edit_file" || toolName === "edit_ast"
	return {
		toolCall: {
			name: toolName,
			arguments: structuredClone(config.toolUse?.params ?? {}),
		},
		permission: {
			header: params.header,
			...(params.locations ? { locations: structuredClone(params.locations) } : {}),
			...(includesResolvedDiffs && params.diffs ? { diffs: structuredClone(params.diffs) } : {}),
		},
		runtime: {
			cwd: config.cwd,
			mode: config.mode,
			isSubagent: config.isSubagentExecution,
		},
	}
}

// Creates a card via taskMessenger and wraps the protocol handle in a CardHandle.
async function createDisplayedCardFromMessenger(
	config: TaskConfig,
	params: CardParams,
	tracker: CardHandle[],
	allowYoloAutoApproval = true,
	isAutoApproved?: () => boolean,
): Promise<ICardHandle> {
	const autoApprovedAction =
		params.requireApproval && ((allowYoloAutoApproval && config.yoloModeToggled) || isAutoApproved?.())
			? (params.actions?.find((candidate) => candidate.primary)?.value ?? DiracAskResponse.APPROVE)
			: undefined
	const displayedParams = autoApprovedAction
		? {
			...params,
			status: params.status === CardStatus.WAITING_FOR_INPUT ? CardStatus.RUNNING : params.status,
			requireApproval: false,
			requireFeedback: false,
			feedbackPlaceholder: undefined,
			actions: undefined,
		}
		: params
	const messengerParams = !autoApprovedAction && isAutoApproved ? { ...displayedParams, isAutoApproved } : displayedParams
	const handle = await config.taskMessenger.createCard(messengerParams)
	const adapterHandle = new CardHandle(handle, displayedParams, autoApprovedAction)
	tracker.push(adapterHandle)
	return adapterHandle
}
