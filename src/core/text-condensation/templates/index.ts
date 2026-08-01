import { TextCondensationTemplateRegistry } from "../TextCondensationTemplateRegistry"
import { conversationContinuationTemplate } from "./conversationContinuationTemplate"
import { taskHandoffTemplate } from "./taskHandoffTemplate"

export { CONVERSATION_CONTINUATION_TEMPLATE_ID, conversationContinuationTemplate } from "./conversationContinuationTemplate"
export { buildTaskHandoffIntentSource, TASK_HANDOFF_TEMPLATE_ID, taskHandoffTemplate } from "./taskHandoffTemplate"

export const defaultTextCondensationTemplates = [conversationContinuationTemplate, taskHandoffTemplate]

export function createDefaultTextCondensationTemplateRegistry(): TextCondensationTemplateRegistry {
	return new TextCondensationTemplateRegistry(defaultTextCondensationTemplates)
}
