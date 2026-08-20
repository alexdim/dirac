import { expect } from "chai"
import { describe, it } from "mocha"
import { UpdateSettingsRequest } from "@shared/proto/dirac/state"
import { getDefaultValue } from "@shared/storage/state-keys"
import { buildWebviewSettingsPatch } from "./settingsWebview"

describe("low-verbosity settings", () => {
	it("is enabled by default", () => {
		expect(getDefaultValue("lowVerbosityEnabled")).to.equal(true)
	})

	it("maps explicit enabled and disabled webview updates", () => {
		expect(buildWebviewSettingsPatch(UpdateSettingsRequest.create({ lowVerbosityEnabled: true }))).to.include({
			lowVerbosityEnabled: true,
		})
		expect(buildWebviewSettingsPatch(UpdateSettingsRequest.create({ lowVerbosityEnabled: false }))).to.include({
			lowVerbosityEnabled: false,
		})
	})
})
