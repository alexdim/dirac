import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { isUtilityTextCondensationAvailable } from "../UtilityTextCondensationAvailability"
import {
	CONVERSATION_CONTINUATION_TEMPLATE_ID,
	createDefaultTextCondensationTemplateRegistry,
	TASK_HANDOFF_TEMPLATE_ID,
} from "../templates"

describe("Utility text condensation availability", () => {
	const templates = createDefaultTextCondensationTemplateRegistry()
	const utilitySelection = { provider: "openai" as const, modelId: "utility-model" }

	it("uses the condensation checkbox only for conversation condensation", () => {
		const settings = {
			utilityModelUseCondense: false,
			utilityModelUseNewTask: true,
			utilityModelSelection: utilitySelection,
		}

		assert.equal(isUtilityTextCondensationAvailable(settings, CONVERSATION_CONTINUATION_TEMPLATE_ID, templates), false)
		assert.equal(isUtilityTextCondensationAvailable(settings, TASK_HANDOFF_TEMPLATE_ID, templates), true)
	})

	it("uses the new-task checkbox only for task handoffs", () => {
		const settings = {
			utilityModelUseCondense: true,
			utilityModelUseNewTask: false,
			utilityModelSelection: utilitySelection,
		}

		assert.equal(isUtilityTextCondensationAvailable(settings, CONVERSATION_CONTINUATION_TEMPLATE_ID, templates), true)
		assert.equal(isUtilityTextCondensationAvailable(settings, TASK_HANDOFF_TEMPLATE_ID, templates), false)
	})

	it("prefers explicit use-case settings over the legacy switch", () => {
		const settings = {
			utilityModelEnabled: true,
			utilityModelUseCondense: false,
			utilityModelUseNewTask: true,
			utilityModelSelection: utilitySelection,
		}

		assert.equal(isUtilityTextCondensationAvailable(settings, CONVERSATION_CONTINUATION_TEMPLATE_ID, templates), false)
		assert.equal(isUtilityTextCondensationAvailable(settings, TASK_HANDOFF_TEMPLATE_ID, templates), true)
	})

	it("uses the legacy switch only when independent use-case settings are absent", () => {
		const enabledLegacySettings = {
			utilityModelEnabled: true,
			utilityModelSelection: utilitySelection,
		}
		const disabledLegacySettings = {
			utilityModelEnabled: false,
			utilityModelSelection: utilitySelection,
		}

		assert.equal(
			isUtilityTextCondensationAvailable(enabledLegacySettings, CONVERSATION_CONTINUATION_TEMPLATE_ID, templates),
			true,
		)
		assert.equal(isUtilityTextCondensationAvailable(enabledLegacySettings, TASK_HANDOFF_TEMPLATE_ID, templates), true)
		assert.equal(
			isUtilityTextCondensationAvailable(disabledLegacySettings, CONVERSATION_CONTINUATION_TEMPLATE_ID, templates),
			false,
		)
	})
})
