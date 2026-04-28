# Provider-Specific Settings

This document details the environment variables and configuration options for specific AI providers in Dirac.

## AWS Bedrock

Use Bedrock by setting AWS credentials and region. When `AWS_ACCESS_KEY_ID` or `AWS_BEDROCK_MODEL` is present, Dirac automatically switches to the Bedrock provider.

### Environment Variables

- `AWS_ACCESS_KEY_ID` — AWS access key
- `AWS_SECRET_ACCESS_KEY` — AWS secret key
- `AWS_SESSION_TOKEN` — session token (for temporary credentials)
- `AWS_REGION` — AWS region (e.g. `us-east-1`). Note: `AWS_REGION` alone will not trigger an automatic switch to Bedrock.
- `AWS_BEDROCK_MODEL` — model ID for both act and plan modes (e.g. `us.anthropic.claude-sonnet-4-6`)
- `AWS_BEDROCK_MODEL_ACT` — model ID for act mode only
- `AWS_BEDROCK_MODEL_PLAN` — model ID for plan mode only

### Usage Example

Works seamlessly with [aws-vault](https://github.com/99designs/aws-vault):

```bash
AWS_REGION=us-east-1 AWS_BEDROCK_MODEL=us.anthropic.claude-sonnet-4-6 \
  aws-vault exec my-profile -- dirac "your task"
```

> **Note:** Newer Claude models on Bedrock (Sonnet 4.6+) require a cross-region inference profile prefix (`us.`, `eu.`, `ap.`). See the [AWS docs](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html) for supported model IDs.

## Google Cloud Vertex AI

Use Vertex AI by setting the following environment variables. When `GOOGLE_CLOUD_PROJECT` or `GCP_PROJECT` is present, Dirac automatically switches to the Vertex provider.

### Environment Variables

- `GOOGLE_CLOUD_PROJECT` or `GCP_PROJECT` — Your Google Cloud project ID.
- `GOOGLE_CLOUD_LOCATION` or `GOOGLE_CLOUD_REGION` — The region for Vertex AI (e.g. `us-central1`).

### Authentication

Dirac uses the default Google Cloud authentication chain. Ensure you have authenticated using the Google Cloud CLI:

```bash
gcloud auth application-default login
```
