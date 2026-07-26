import { theme } from "../constants/theme"
import { Box, Text, useInput } from "ink"
import Spinner from "ink-spinner"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { openExternal } from "@/utils/env"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"

interface OpenAiCodexDeviceAuthViewProps {
	onComplete: () => void | Promise<void>
	onCancel: () => void
}

export const OpenAiCodexDeviceAuthView: React.FC<OpenAiCodexDeviceAuthViewProps> = ({ onComplete, onCancel }) => {
	const { isRawModeSupported } = useStdinContext()
	const abortControllerRef = useRef<AbortController | null>(null)
	const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const isActiveRef = useRef(true)
	const onCompleteRef = useRef(onComplete)
	onCompleteRef.current = onComplete
	const [step, setStep] = useState<"initiating" | "waiting" | "success" | "error">("initiating")
	const [authData, setAuthData] = useState<{
		verification_uri: string
		verification_uri_complete?: string
		user_code: string
		device_code: string
		interval?: number
	} | null>(null)
	const [errorMessage, setErrorMessage] = useState("")
	const [browserWarning, setBrowserWarning] = useState("")

	const startAuth = useCallback(async () => {
		const abortController = new AbortController()
		abortControllerRef.current = abortController

		try {
			setStep("initiating")
			const data = await openAiCodexOAuthManager.initiateDeviceFlow()
			if (!isActiveRef.current) return
			setAuthData(data)
			setStep("waiting")

			try {
				await openExternal(data.verification_uri)
			} catch (error) {
				if (!isActiveRef.current) return
				setBrowserWarning(`Could not open the browser automatically: ${error instanceof Error ? error.message : String(error)}`)
			}

			await openAiCodexOAuthManager.pollForDeviceToken(
				data.device_code,
				data.user_code,
				data.interval ?? 5,
				abortController.signal,
			)
			if (!isActiveRef.current) return
			setStep("success")
			completionTimeoutRef.current = setTimeout(() => {
				if (!isActiveRef.current) return
				void Promise.resolve(onCompleteRef.current()).catch((error) => {
					if (!isActiveRef.current) return
					setErrorMessage(error instanceof Error ? error.message : String(error))
					setStep("error")
				})
			}, 1500)
		} catch (error) {
			if (!isActiveRef.current) return
			setErrorMessage(error instanceof Error ? error.message : String(error))
			setStep("error")
		}
	}, [])

	useEffect(() => {
		isActiveRef.current = true
		startAuth()

		return () => {
			isActiveRef.current = false
			abortControllerRef.current?.abort()
			if (completionTimeoutRef.current) clearTimeout(completionTimeoutRef.current)
		}
	}, [startAuth])

	useInput(
		(_, key) => {
			if (key.escape) {
				isActiveRef.current = false
				abortControllerRef.current?.abort()
				if (completionTimeoutRef.current) clearTimeout(completionTimeoutRef.current)
				onCancel()
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Box flexDirection="column" padding={1}>
			{step === "initiating" && (
				<Box>
					<Text color={COLORS.primaryBlue}>
						<Spinner type="dots" />
					</Text>
					<Text color={theme.text}> Initiating ChatGPT device authentication...</Text>
				</Box>
			)}

			{step === "waiting" && authData && (
				<Box flexDirection="column">
					<Box>
						<Text color={COLORS.primaryBlue}>
							<Spinner type="dots" />
						</Text>
						<Text color={theme.text}> Waiting for ChatGPT authorization...</Text>
					</Box>
					<Text> </Text>
					<Text color={theme.text}>1. Open: </Text>
					<Text color={theme.info} bold underline wrap="wrap">
						{authData.verification_uri_complete || authData.verification_uri}
					</Text>
					<Text> </Text>
					<Text color={theme.text}>2. Enter code: </Text>
					<Text color={theme.warning} bold>
						{authData.user_code}
					</Text>
					<Text> </Text>
					<Text color={theme.muted}>The browser should have opened automatically if available.</Text>
					{browserWarning && <Text color={theme.warning}>{browserWarning}</Text>}
					<Text color={theme.muted}>Press Esc to cancel.</Text>
				</Box>
			)}

			{step === "success" && (
				<Box>
					<Text color={theme.success}>✔</Text>
					<Text color={theme.text}> Successfully authenticated with ChatGPT!</Text>
				</Box>
			)}

			{step === "error" && (
				<Box flexDirection="column">
					<Text color={theme.error} bold>
						Authentication Error
					</Text>
					<Text color={theme.text}>{errorMessage}</Text>
					<Text> </Text>
					<Text color={theme.muted}>Press Esc to go back.</Text>
				</Box>
			)}
		</Box>
	)
}
