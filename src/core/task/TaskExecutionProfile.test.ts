import { strict as assert } from "node:assert"
import type { DiracDefaultTool, DiracToolSpec } from "@shared/tools"
import { describe, it } from "mocha"
import {
	isDiscoveredToolAvailableToTaskProfile,
	isToolAvailableToTaskProfile,
	type TaskExecutionProfile,
	taskProfileSystemInstructions,
} from "./TaskExecutionProfile"
import type { DiscoveredTool } from "./tools/discovery/DiscoveredTool"

function profileTool(profiles: readonly TaskExecutionProfile[]): DiscoveredTool {
	const spec = { id: "profile_tool" as DiracDefaultTool, name: "profile_tool", description: "Profile tool" } as DiracToolSpec
	return {
		id: "profile_tool",
		name: "profile_tool",
		source: "builtin",
		exposure: { kind: "profile_only", profiles },
		spec,
		factory: () => ({ spec: () => spec, supportedSurfaces: () => ["all"], processCall: async () => "ok" }),
		modulePath: "modules/profile_tool/tool.ts",
	}
}

describe("Task execution profiles", () => {
	it("centrally excludes new_task from both Goal-owned profiles", () => {
		assert.equal(isToolAvailableToTaskProfile("standalone", "new_task"), true)
		assert.equal(isToolAvailableToTaskProfile("goal_coordinator", "new_task"), false)
		assert.equal(isToolAvailableToTaskProfile("goal_child", "new_task"), false)
	})

	it("keeps Goal tools exclusive to the coordinator", () => {
		assert.equal(isToolAvailableToTaskProfile("standalone", "start_task"), false)
		assert.equal(isToolAvailableToTaskProfile("goal_coordinator", "start_task"), true)
		assert.equal(isToolAvailableToTaskProfile("goal_child", "start_task"), false)
	})

	it("enforces declared profile-only exposure independently of tool naming", () => {
		const tool = profileTool(["goal_child"])
		assert.equal(isDiscoveredToolAvailableToTaskProfile("standalone", tool), false)
		assert.equal(isDiscoveredToolAvailableToTaskProfile("goal_coordinator", tool), false)
		assert.equal(isDiscoveredToolAvailableToTaskProfile("goal_child", tool), true)
	})

	it("asks contained Goal Tasks for concise private trajectory updates", () => {
		const instructions = taskProfileSystemInstructions("goal_child")

		assert.match(instructions ?? "", /Keep the parent meaningfully informed during non-trivial work/)
		assert.match(instructions ?? "", /substantive finding or milestone/)
		assert.match(instructions ?? "", /not routine tool narration or a timed cadence/)
		assert.match(instructions ?? "", /normally one sentence, sometimes two, and only rarely three/)
	})

	it("asks the Goal coordinator to synthesize concise user-visible progress", () => {
		const instructions = taskProfileSystemInstructions("goal_coordinator")

		assert.match(instructions ?? "", /user opening it during the run can quickly understand/)
		assert.match(instructions ?? "", /Most should remain private; synthesize only information/)
		assert.match(instructions ?? "", /post merely because a heartbeat occurred/)
		assert.match(instructions ?? "", /normally one sentence, sometimes two, and only rarely three/)
	})

	it("does not add Goal progress guidance to standalone Tasks", () => {
		assert.equal(taskProfileSystemInstructions("standalone"), undefined)
	})
})
