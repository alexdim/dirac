/**
 * Bedrock AWS auth + client construction. Extracted from `bedrock.ts` (FB-15b).
 * Takes the subset of provider options it needs so it never imports the handler.
 */
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"

export interface AwsBedrockClientOptions {
	awsAuthentication?: string
	awsUseProfile?: boolean
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsProfile?: string
	awsRegion?: string
	awsBedrockApiKey?: string
	awsBedrockEndpoint?: string
}

/** Returns the AWS region to use for the given options, with a default fallback. */
export function resolveRegion(options: AwsBedrockClientOptions, defaultRegion: string): string {
	return options.awsRegion || defaultRegion
}

/** Builds an AWS credentials resolver chain, then a BedrockRuntimeClient. */
/** Resolves AWS credentials from options or the node provider chain, without mutating env. */
export async function resolveAwsCredentials(
	options: AwsBedrockClientOptions,
	region: string,
	userAgentAppId: string,
): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }> {
	const useProfile =
		(options.awsAuthentication === undefined && options.awsUseProfile) ||
		options.awsAuthentication === "profile"
	if (!useProfile && options.awsAccessKey && options.awsSecretKey) {
		return {
			accessKeyId: options.awsAccessKey,
			secretAccessKey: options.awsSecretKey,
			sessionToken: options.awsSessionToken,
		}
	}
	const providerOptions: {
		clientConfig: { userAgentAppId: string; region?: string }
		ignoreCache?: boolean
		profile?: string
	} = {
		clientConfig: { userAgentAppId },
	}
	providerOptions.clientConfig.region = region
	if (useProfile) {
		providerOptions.ignoreCache = true
		if (options.awsProfile) providerOptions.profile = options.awsProfile
	}
	return await fromNodeProviderChain(providerOptions as never)()
}



export async function createBedrockClient(
	options: AwsBedrockClientOptions,
	defaultRegion: string,
	userAgentAppId: string,
): Promise<BedrockRuntimeClient> {
	const region = resolveRegion(options, defaultRegion)

	let auth: unknown
	if (options.awsAuthentication === "apikey") {
		auth = {
			token: { token: options.awsBedrockApiKey },
			authSchemePreference: ["httpBearerAuth"],
		}
	} else {
		const credentials = await resolveAwsCredentials(options, region, userAgentAppId)
		auth = {
			credentials: {
				accessKeyId: credentials.accessKeyId,
				secretAccessKey: credentials.secretAccessKey,
				sessionToken: credentials.sessionToken,
			},
		}
	}

	return new BedrockRuntimeClient({
		userAgentAppId,
		region,
		...(auth as Record<string, unknown>),
		...(options.awsBedrockEndpoint ? { endpoint: options.awsBedrockEndpoint } : {}),
	})
}
