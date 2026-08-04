import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { DocumentOperationManager } from "../DocumentOperationManager"

const FILE_PATH = "/tmp/dirac-document-operation-manager-test.ts"

describe("DocumentOperationManager", () => {
	beforeEach(() => {
		;(vscode.workspace as any).fs = {
			stat: sinon.stub().resolves({}),
			writeFile: sinon.stub().resolves(),
		}
		;(vscode.WorkspaceEdit as any).prototype.replace = sinon.stub()
	})

	afterEach(() => {
		sinon.restore()
		delete (vscode.workspace as any).fs
		delete (vscode.WorkspaceEdit as any).prototype.replace
	})

	it("reports a failed dirty-document save", async () => {
		const manager = new DocumentOperationManager()
		const editor = {
			document: {
				isDirty: true,
				save: sinon.stub().resolves(false),
			},
		}

		assert.equal(await manager.saveDocument(editor as any), false)
	})

	it("rejects a silent write when VS Code does not apply the edit", async () => {
		const save = sinon.stub().resolves(true)
		sinon.stub(vscode.workspace, "openTextDocument").resolves(createDocument(save) as any)
		sinon.stub(vscode.workspace, "applyEdit").resolves(false)

		const manager = new DocumentOperationManager()

		await assert.rejects(manager.applyAndSaveSilently(FILE_PATH, "new content"), /Failed to apply edit in VS Code/)
		assert.equal(save.callCount, 0)
	})

	it("rejects a silent write when VS Code does not save the document", async () => {
		const save = sinon.stub().resolves(false)
		sinon.stub(vscode.workspace, "openTextDocument").resolves(createDocument(save) as any)
		sinon.stub(vscode.workspace, "applyEdit").resolves(true)

		const manager = new DocumentOperationManager()

		await assert.rejects(manager.applyAndSaveSilently(FILE_PATH, "new content"), /Failed to save document in VS Code/)
	})

	it("rejects a batch write when VS Code does not apply the edit", async () => {
		const save = sinon.stub().resolves(true)
		sinon.stub(vscode.workspace, "openTextDocument").resolves(createDocument(save) as any)
		sinon.stub(vscode.workspace, "applyEdit").resolves(false)

		const manager = new DocumentOperationManager()

		await assert.rejects(
			manager.applyAndSaveBatchSilently([{ path: FILE_PATH, content: "new content" }]),
			/Failed to apply batch edit in VS Code/,
		)
		assert.equal(save.callCount, 0)
	})

	it("rejects a batch write when VS Code does not save a document", async () => {
		const save = sinon.stub().resolves(false)
		sinon.stub(vscode.workspace, "openTextDocument").resolves(createDocument(save) as any)
		sinon.stub(vscode.workspace, "applyEdit").resolves(true)

		const manager = new DocumentOperationManager()

		await assert.rejects(
			manager.applyAndSaveBatchSilently([{ path: FILE_PATH, content: "new content" }]),
			/Failed to save document .* in VS Code/,
		)
	})
})

function createDocument(save: sinon.SinonStub) {
	return {
		uri: vscode.Uri.file(FILE_PATH),
		lineCount: 1,
		getText: () => "existing content",
		save,
	}
}
