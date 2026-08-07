import Section from "../Section"
import UtilityModelSelection from "../UtilityModelSelection"

interface UtilityModelSectionProps {
	renderSectionHeader?: (tabId: string) => JSX.Element | null
}

const UtilityModelSection = ({ renderSectionHeader }: UtilityModelSectionProps) => (
	<div>
		{renderSectionHeader?.("utility-model")}
		<Section>
			<UtilityModelSelection />
		</Section>
	</div>
)

export default UtilityModelSection
