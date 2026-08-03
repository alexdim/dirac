// Shared types for slash-command parsing and execution.

type FileBasedWorkflow = {
	fullPath: string
	fileName: string
	isRemote: false
}

type RemoteWorkflow = {
	fullPath: string
	fileName: string
	isRemote: true
	contents: string
}

export type Workflow = FileBasedWorkflow | RemoteWorkflow

export type SlashCommandDirectAction =
	| { type: "condenseConversation" }
	| { type: "activateSkill"; skillId: string }

export type ParseSlashCommandResult = {
	processedText: string
	needsDiracrulesFileCheck: boolean
	isDirectResponse?: boolean
	directResponseText?: string
	directAction?: SlashCommandDirectAction
}

export type SlashCommandMatch = {
	commandName: string
	tagContent: string
	contentStartIndex: number
	slashMatch: RegExpExecArray
	regexObj: RegExp
}
