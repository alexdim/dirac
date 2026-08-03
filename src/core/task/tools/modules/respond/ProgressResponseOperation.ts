import { IToolEnvironment } from "../../interfaces/IToolEnvironment"

export async function presentProgressResponse(text: string, env: IToolEnvironment): Promise<string> {
	await env.ui.upsertText(text, false, "assistant")

	return "Message received. Please proceed with the next step of the task."
}
