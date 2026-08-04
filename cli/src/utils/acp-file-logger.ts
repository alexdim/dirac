import pino, { type Logger as PinoLogger } from "pino"
import { createRotatingFileLogger, type RotatingFileLogger } from "@/shared/services/file-logger"
import { Logger } from "@/shared/services/Logger"
import { DIRAC_CLI_DIR } from "./path"

let acpFileLogger: PinoLogger | undefined
let acpRotatingFileLogger: RotatingFileLogger | undefined
let unsubscribeAcpLogger: (() => void) | undefined

/** Subscribe the shared logger to ACP's bounded dedicated file. */
export function initAcpFileLogger(): void {
	if (acpFileLogger) return

	acpRotatingFileLogger = createRotatingFileLogger({ logDir: DIRAC_CLI_DIR.log, fileName: "dirac-acp.log" })
	acpFileLogger = pino({ timestamp: pino.stdTimeFunctions.isoTime }, acpRotatingFileLogger)
	unsubscribeAcpLogger = Logger.subscribe((message) => acpFileLogger?.info(message))
}

export async function disposeAcpFileLogger(): Promise<void> {
	unsubscribeAcpLogger?.()
	unsubscribeAcpLogger = undefined
	acpFileLogger = undefined

	if (acpRotatingFileLogger) {
		await acpRotatingFileLogger.dispose()
		acpRotatingFileLogger = undefined
	}
}
