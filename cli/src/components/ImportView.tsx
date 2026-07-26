import { theme } from "../constants/theme"
/**
 * Import view component
 * Handles importing API keys from competing CLI agents (Codex, OpenCode)
 */

import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useState } from "react"
import { StateManager } from "@/core/storage/StateManager"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import {
	getProviderDisplayName,
	getSourceDisplayName,
	type ImportedKey,
	ImportSource,
	importFromCodex,
	importFromOpenCode,
} from "../utils/import-configs"
import { applyProviderConfig } from "../utils/provider-config"
import { shouldIgnoreTerminalInput } from "../utils/input"

enum ImportStep {
	SELECT = "select",
	CONFIRM = "confirm",
	SAVING = "saving",
	ERROR = "error",
}

interface ImportViewProps {
	source: ImportSource
	onComplete: () => void
	onCancel: () => void
}

function maskApiKey(apiKey: string): string {
	if (apiKey.length <= 8) return "•".repeat(apiKey.length)
	return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`
}

export const ImportView: React.FC<ImportViewProps> = ({ source, onComplete, onCancel }) => {
	const { isRawModeSupported } = useStdinContext()
	const [step, setStep] = useState<ImportStep>(ImportStep.SELECT)
	const [keys, setKeys] = useState<ImportedKey[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [confirmIndex, setConfirmIndex] = useState(0)
	const [errorMessage, setErrorMessage] = useState("")

	// Load keys on mount
	useEffect(() => {
		const result = source === ImportSource.CODEX ? importFromCodex() : importFromOpenCode()
		if (result && result.keys.length > 0) {
			setKeys(result.keys)
			if (result.keys.length === 1) {
				// Only one key, go straight to confirm
				setStep(ImportStep.CONFIRM)
			}
		} else {
			setErrorMessage(`Could not read API keys from ${getSourceDisplayName(source)} config`)
			setStep(ImportStep.ERROR)
		}
	}, [source])

	const handleConfirm = useCallback(async () => {
		try {
			setStep(ImportStep.SAVING)

			const selectedKey = keys[selectedIndex]
			if (!selectedKey) {
				setErrorMessage("No key selected")
				setStep(ImportStep.ERROR)
				return
			}

			await applyProviderConfig({
				providerId: selectedKey.provider,
				apiKey: selectedKey.key,
				modelId: selectedKey.modelId,
			})
			const stateManager = StateManager.get()
			stateManager.setGlobalState("welcomeViewCompleted", true)
			await stateManager.flushPendingState()

			onComplete()
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error))
			setStep(ImportStep.ERROR)
		}
	}, [keys, selectedIndex, onComplete])

	useInput(
		(input, key) => {
			if (shouldIgnoreTerminalInput(input, key)) return
			if (key.escape) {
				if (step === ImportStep.CONFIRM && keys.length > 1) {
					setStep(ImportStep.SELECT)
					setConfirmIndex(0)
				} else if (step === ImportStep.ERROR) {
					onCancel()
				} else {
					onCancel()
				}
				return
			}

			if (step === ImportStep.SELECT) {
				if (key.upArrow) {
					setSelectedIndex((prev) => (prev > 0 ? prev - 1 : keys.length - 1))
				} else if (key.downArrow) {
					setSelectedIndex((prev) => (prev < keys.length - 1 ? prev + 1 : 0))
				} else if (key.return) {
					setStep(ImportStep.CONFIRM)
				}
			} else if (step === ImportStep.CONFIRM) {
				if (key.upArrow || key.downArrow) {
					setConfirmIndex((prev) => (prev === 0 ? 1 : 0))
				} else if (key.return) {
					if (confirmIndex === 0) {
						handleConfirm()
					} else {
						onCancel()
					}
				}
			} else if (step === ImportStep.ERROR) {
				if (key.return) {
					onCancel()
				}
			}
		},
		{ isActive: isRawModeSupported && step !== ImportStep.SAVING },
	)

	const sourceName = getSourceDisplayName(source)

	if (step === ImportStep.SELECT) {
		return (
			<Box flexDirection="column">
				<Text color={theme.text}>Select which key to import from {sourceName}</Text>
				<Text> </Text>
				{keys.map((k, i) => (
					<Box key={`${k.provider}-${i}`}>
						<Text color={i === selectedIndex ? COLORS.primaryBlue : undefined}>
							{i === selectedIndex ? "❯ " : "  "}
							{getProviderDisplayName(k.provider)}
						</Text>
					</Box>
				))}
				<Text> </Text>
				<Text color={theme.muted}>Arrows to navigate, Enter to select, Esc to go back</Text>
			</Box>
		)
	}

	if (step === ImportStep.CONFIRM) {
		const selectedKey = keys[selectedIndex]
		const providerName = selectedKey ? getProviderDisplayName(selectedKey.provider) : ""
		const maskedKey = selectedKey ? maskApiKey(selectedKey.key) : ""

		return (
			<Box flexDirection="column">
				<Text color={theme.text}>Import API key from {sourceName}?</Text>
				<Text> </Text>
				<Box>
					<Text color={theme.muted}>Provider: </Text>
					<Text color={theme.text}>{providerName}</Text>
				</Box>
				<Box>
					<Text color={theme.muted}>API Key: </Text>
					<Text color={theme.text}>{maskedKey}</Text>
				</Box>
				{selectedKey?.modelId && (
					<Box>
						<Text color={theme.muted}>Model: </Text>
						<Text color={theme.text}>{selectedKey.modelId}</Text>
					</Box>
				)}
				<Text> </Text>
				<Box>
					<Text color={confirmIndex === 0 ? COLORS.primaryBlue : undefined}>
						{confirmIndex === 0 ? "❯ " : "  "}
						Confirm import
					</Text>
				</Box>
				<Box>
					<Text color={confirmIndex === 1 ? COLORS.primaryBlue : undefined}>
						{confirmIndex === 1 ? "❯ " : "  "}
						Cancel
					</Text>
				</Box>
				<Text> </Text>
				<Text color={theme.muted}>Enter to confirm, Esc to go back</Text>
			</Box>
		)
	}

	if (step === ImportStep.SAVING) {
		return (
			<Box>
				<Text color={theme.text}>Importing configuration...</Text>
			</Box>
		)
	}

	if (step === ImportStep.ERROR) {
		return (
			<Box flexDirection="column">
				<Text bold color={theme.error}>
					Something went wrong
				</Text>
				<Text> </Text>
				<Text color={theme.warning}>{errorMessage}</Text>
				<Text> </Text>
				<Text color={theme.muted}>Press Enter or Esc to go back</Text>
			</Box>
		)
	}

	return null
}
