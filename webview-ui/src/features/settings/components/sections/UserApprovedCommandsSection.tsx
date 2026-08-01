import type { UserApprovedCommand, UserApprovedCommandMatch } from "@shared/UserApprovedCommand"
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { useSettingsStore } from "@/features/settings/store/settingsStore"
import Section from "../Section"
import { persistSetting } from "../utils/settingsHandlers"

interface UserApprovedCommandsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

export const UserApprovedCommandsSection = ({ renderSectionHeader }: UserApprovedCommandsSectionProps) => {
	const userApprovedCommands = useSettingsStore((state) => state.userApprovedCommands)
	const [command, setCommand] = useState("")
	const [match, setMatch] = useState<UserApprovedCommandMatch>("exact")
	const [editingIndex, setEditingIndex] = useState<number | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [isSaving, setIsSaving] = useState(false)
	const mutationInProgress = useRef(false)

	useEffect(() => {
		if (editingIndex !== null && editingIndex >= userApprovedCommands.length) cancelEdit()
	}, [editingIndex, userApprovedCommands.length])

	const cancelEdit = () => {
		setCommand("")
		setMatch("exact")
		setEditingIndex(null)
		setError(null)
	}

	const persistCommands = async (commands: UserApprovedCommand[]): Promise<boolean> => {
		if (mutationInProgress.current) return false
		mutationInProgress.current = true
		setIsSaving(true)
		setError(null)
		try {
			await persistSetting("userApprovedCommands", { commands })
			useSettingsStore.getState().setSettings({ userApprovedCommands: commands })
			return true
		} catch (error) {
			setError(error instanceof Error ? error.message : "Could not save approved commands.")
			return false
		} finally {
			mutationInProgress.current = false
			setIsSaving(false)
		}
	}

	const save = async () => {
		const trimmedCommand = command.trim()
		if (!trimmedCommand) {
			setError("Enter a command.")
			return
		}
		if (trimmedCommand.includes("\n") || trimmedCommand.includes("\r")) {
			setError("Commands must be a single line.")
			return
		}

		const entry: UserApprovedCommand = { command: trimmedCommand, match }
		const duplicate = userApprovedCommands.some(
			(candidate, index) => index !== editingIndex && candidate.command === entry.command && candidate.match === entry.match,
		)
		if (duplicate) {
			setError("That command and match mode are already listed.")
			return
		}

		const next = [...userApprovedCommands]
		if (editingIndex === null) next.push(entry)
		else next[editingIndex] = entry
		if (await persistCommands(next)) cancelEdit()
	}

	const edit = (entry: UserApprovedCommand, index: number) => {
		setCommand(entry.command)
		setMatch(entry.match)
		setEditingIndex(index)
		setError(null)
	}

	const remove = async (index: number) => {
		const saved = await persistCommands(userApprovedCommands.filter((_, candidateIndex) => candidateIndex !== index))
		if (saved && editingIndex === index) cancelEdit()
	}

	return (
		<div>
			{renderSectionHeader("user-approved-commands")}
			<Section>
				<p className="m-0 text-sm text-(--vscode-descriptionForeground)">
					Use care: Matching commands run without confirmation and bypass Dirac’s built-in command safety validation.
					Configured permission rules still apply.
				</p>

				<div className="flex flex-col gap-2 rounded border border-(--vscode-widget-border) p-3">
					<label className="font-medium" htmlFor="user-approved-command-input">Command</label>
					<VSCodeTextField
						className="w-full font-mono"
						disabled={isSaving}
						id="user-approved-command-input"
						onInput={(event) => {
							setCommand((event.target as HTMLInputElement).value)
							setError(null)
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !isSaving) void save()
						}}
						placeholder="npm test"
						value={command}
					/>

					<label className="font-medium" htmlFor="user-approved-command-match">Match</label>
					<VSCodeDropdown
						className="w-full"
						disabled={isSaving}
						id="user-approved-command-match"
						onChange={(event) => setMatch((event.target as HTMLSelectElement).value as UserApprovedCommandMatch)}
						value={match}>
						<VSCodeOption value="exact">Exact command</VSCodeOption>
						<VSCodeOption value="prefix">Command starts with</VSCodeOption>
					</VSCodeDropdown>
					<p className="m-0 text-xs text-(--vscode-descriptionForeground)">
						{match === "exact"
							? "Only the complete command is approved."
							: "The command and any additional arguments are approved. Chained commands are checked separately."}
					</p>
					{error && <p className="m-0 text-xs text-(--vscode-errorForeground)">{error}</p>}
					<div className="flex justify-end gap-2">
						{editingIndex !== null && <VSCodeButton appearance="secondary" disabled={isSaving} onClick={cancelEdit}>Cancel</VSCodeButton>}
						<VSCodeButton disabled={isSaving} onClick={() => void save()}>
							{isSaving ? "Saving…" : editingIndex === null ? "Add command" : "Save command"}
						</VSCodeButton>
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<h3 className="m-0 text-sm font-medium">Approved commands</h3>
					{userApprovedCommands.length === 0 ? (
						<p className="m-0 text-sm text-(--vscode-descriptionForeground)">No user-approved commands.</p>
					) : (
						userApprovedCommands.map((entry, index) => (
							<div className="flex items-center gap-3 rounded border border-(--vscode-widget-border) px-3 py-2" key={`${entry.match}:${entry.command}`}>
								<code className="min-w-0 flex-1 break-all">{entry.command}</code>
								<span className="shrink-0 text-xs text-(--vscode-descriptionForeground)">
									{entry.match === "exact" ? "Exact" : "Starts with"}
								</span>
								<VSCodeButton appearance="secondary" disabled={isSaving} onClick={() => edit(entry, index)}>Edit</VSCodeButton>
								<VSCodeButton appearance="secondary" disabled={isSaving} onClick={() => void remove(index)}>Delete</VSCodeButton>
							</div>
						))
					)}
				</div>
			</Section>
		</div>
	)
}

export default UserApprovedCommandsSection
