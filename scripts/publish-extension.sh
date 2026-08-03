#!/bin/bash

set -euo pipefail

echo "scripts/publish-extension.sh is deprecated." >&2
echo "Use the unified resumable publisher instead:" >&2
echo "  scripts/publish.sh {patch|minor|major}" >&2
echo "  scripts/publish.sh --resume vX.Y.Z" >&2
exit 1
