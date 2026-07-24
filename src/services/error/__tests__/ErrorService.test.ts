/**
 * Characterization tests for ErrorService.
 * Captures current behavior — bugs and all.
 *
 * Phase 0 — Prerequisite coverage for refactoring
 */
import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { DiracError, DiracErrorType } from "../DiracError"
import { ErrorProviderFactory } from "../ErrorProviderFactory"
import { ErrorService } from "../ErrorService"
import type { IErrorProvider } from "../providers/IErrorProvider"
import { TEST_MODEL_IDS } from "@test/fixtures/model-ids"
import { expectLoggerErrors } from "@/test/loggerGuard"

describe("ErrorService", () => {
	let sandbox: sinon.SinonSandbox
	let mockProvider: IErrorProvider
	let service: ErrorService

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		mockProvider = {
			captureException: sandbox.stub(),
			logException: sandbox.stub(),
			logMessage: sandbox.stub(),
			isEnabled: sandbox.stub().returns(true),
			getSettings: sandbox.stub().returns({ enabled: true }),
			dispose: sandbox.stub().resolves(),
		}
		sandbox.stub(ErrorProviderFactory, "createProvider").resolves(mockProvider)
		sandbox.stub(ErrorProviderFactory, "getDefaultConfig").returns({ type: "no-op", config: {} as any })
		service = new ErrorService(mockProvider)
			// Reset singleton for static tests
			; (ErrorService as any).instance = null
	})

	afterEach(() => {
		sandbox.restore()
	})

	// ---------------------------------------------------------------
	describe("static initialize", () => {
		it("creates singleton instance", async () => {
			const inst = await ErrorService.initialize()
			inst.should.be.instanceOf(ErrorService)
		})

		it("returns existing instance if already initialized", async () => {
			const fake = {} as any
				; (ErrorService as any).instance = fake
			const result = await ErrorService.initialize()
			result.should.equal(fake)
		})
	})

	// ---------------------------------------------------------------
	describe("static get", () => {
		it("returns singleton after initialize", async () => {
			const inst = await ErrorService.initialize()
			ErrorService.get().should.equal(inst)
		})

		it("throws if not initialized", () => {
			; (ErrorService as any).instance = null
				; (() => ErrorService.get()).should.throw()
		})
	})

	// ---------------------------------------------------------------
	describe("captureException", () => {
		it("delegates to provider", () => {
			const err = new Error("test")
			service.captureException(err, { key: "val" })
			sinon.assert.calledWith(mockProvider.captureException as any, err, { key: "val" })
		})

		it("accepts DiracError", () => {
			const de = new DiracError("dirac error", "test")
			service.captureException(de)
			sinon.assert.calledOnce(mockProvider.captureException as any)
		})
	})

	// ---------------------------------------------------------------
	describe("logException", () => {
		it("delegates to provider and logs", () => {
			expectLoggerErrors()
			const err = new Error("test")
			service.logException(err)
			sinon.assert.calledOnce(mockProvider.logException as any)
		})

		it("accepts properties", () => {
			expectLoggerErrors()
			service.logException(new Error("test"), { ctx: "test" })
			sinon.assert.calledWithMatch(mockProvider.logException as any, sinon.match.any, { ctx: "test" })
		})
	})

	// ---------------------------------------------------------------
	describe("logMessage", () => {
		it("delegates to provider with default level", () => {
			service.logMessage("test message")
			sinon.assert.calledWith(mockProvider.logMessage as any, "test message", "log", undefined)
		})

		it("passes custom level", () => {
			service.logMessage("warning", "warning")
			sinon.assert.calledWith(mockProvider.logMessage as any, "warning", "warning", undefined)
		})

		it("passes properties", () => {
			service.logMessage("msg", "info", { key: "val" })
			sinon.assert.calledWith(mockProvider.logMessage as any, "msg", "info", { key: "val" })
		})
	})

	// ---------------------------------------------------------------
	describe("toDiracError", () => {
		it("transforms raw error to DiracError", () => {
			expectLoggerErrors()
			const result = service.toDiracError(new Error("raw"))
			result.should.be.instanceOf(DiracError)
		})

		it("logs the transformed error", () => {
			expectLoggerErrors()
			service.toDiracError(new Error("raw"), TEST_MODEL_IDS.OPENAI, "openai")
			sinon.assert.calledOnce(mockProvider.logException as any)
		})

		it("passes modelId and providerId", () => {
			expectLoggerErrors()
			const result = service.toDiracError("string error", "claude", "anthropic")
			result.should.be.instanceOf(DiracError)
		})
	})

	// ---------------------------------------------------------------
	describe("DiracError classification", () => {
		it("classifies HTTP 402 as payment instead of authentication", () => {
			const error = new DiracError({ message: "Payment Required", status: 402 })

			error.isErrorType(DiracErrorType.Payment).should.equal(true)
			error.isErrorType(DiracErrorType.Auth).should.equal(false)
			error.toDisplayMessage().should.equal(
				"Payment Required\n\nPayment is required by the configured provider. Check its billing, credits, and model access.",
			)
		})

		it("classifies only 401 and 403 status codes as authentication failures", () => {
			new DiracError({ message: "Unauthorized", status: 401 }).isErrorType(DiracErrorType.Auth).should.equal(true)
			new DiracError({ message: "Forbidden", status: 403 }).isErrorType(DiracErrorType.Auth).should.equal(true)
			new DiracError({ message: "Bad Request", status: 400 }).isErrorType(DiracErrorType.Auth).should.equal(false)
		})

		it("classifies numeric-string HTTP statuses", () => {
			new DiracError({ message: "Payment Required", status: "402" as any })
				.isErrorType(DiracErrorType.Payment)
				.should.equal(true)
			new DiracError({ message: "Unauthorized", status: "401" as any }).isErrorType(DiracErrorType.Auth).should.equal(true)
			new DiracError({ message: "Forbidden", status: "403" as any }).isErrorType(DiracErrorType.Auth).should.equal(true)
		})


		it("preserves provider auth error text alongside guidance", () => {
			const error = new DiracError({ message: "Invalid bearer token", status: 401 })

			error.toDisplayMessage().should.equal(
				"Invalid bearer token\n\nAuthentication failed. Please verify your API key configuration.",
			)
		})
	})

	// ---------------------------------------------------------------

	describe("isEnabled", () => {
		it("delegates to provider", () => {
			service.isEnabled().should.be.true()
			sinon.assert.calledOnce(mockProvider.isEnabled as any)
		})
	})

	// ---------------------------------------------------------------
	describe("getSettings", () => {
		it("delegates to provider", () => {
			service.getSettings().should.deepEqual({ enabled: true })
		})
	})

	// ---------------------------------------------------------------
	describe("getProvider", () => {
		it("returns the provider instance", () => {
			service.getProvider().should.equal(mockProvider)
		})
	})

	// ---------------------------------------------------------------
	describe("dispose", () => {
		it("delegates to provider", async () => {
			await service.dispose()
			sinon.assert.calledOnce(mockProvider.dispose as any)
		})
	})
})
