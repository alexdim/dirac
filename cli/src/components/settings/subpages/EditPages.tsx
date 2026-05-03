import React from "react"
import { Box, Text } from "ink"
import { COLORS } from "../../../constants/colors"
import { ApiKeyInput } from "../../ApiKeyInput"
import { getProviderLabel } from "../../ProviderPicker"
import { ObjectEditorPanel, type ObjectEditorState } from "../../ConfigViewComponents"
import { getObjectAtPath, setObjectValueAtPath } from "../../../utils/config"

interface ApiKeyInputPageProps {
	isActive: boolean
	onCancel: () => void
	onChange: (value: string) => void
	onSubmit: (value: string) => void
	pendingProvider: string
	apiKeyValue: string
}

export const ApiKeyInputPage: React.FC<ApiKeyInputPageProps> = ({
	isActive,
	onCancel,
	onChange,
	onSubmit,
	pendingProvider,
	apiKeyValue,
}) => (
	<ApiKeyInput
		isActive={isActive}
		onCancel={onCancel}
		onChange={onChange}
		onSubmit={onSubmit}
		providerName={getProviderLabel(pendingProvider)}
		value={apiKeyValue}
	/>
)

interface EditValuePageProps {
	label?: string
	value: string
}

export const EditValuePage: React.FC<EditValuePageProps> = ({ label, value }) => (
	<Box flexDirection="column">
		<Text bold color={COLORS.primaryBlue}>
			Edit: {label}
		</Text>
		<Box marginTop={1}>
			<Text color="white">{value}</Text>
			<Text color="gray">|</Text>
		</Box>
		<Text color="gray">Enter to save, Esc to cancel</Text>
	</Box>
)

interface ObjectEditorPageProps {
	objectEditor: ObjectEditorState
	setObjectEditor: React.Dispatch<React.SetStateAction<ObjectEditorState | null>>
	onPersist: (nextObject: Record<string, unknown>) => void
}

export const ObjectEditorPage: React.FC<ObjectEditorPageProps> = ({ objectEditor, setObjectEditor, onPersist }) => (
	<ObjectEditorPanel
		getObjectAtPath={getObjectAtPath}
		onClose={() => setObjectEditor(null)}
		onPersist={onPersist}
		setObjectValueAtPath={setObjectValueAtPath}
		setState={setObjectEditor}
		state={objectEditor}
	/>
)
