#!/usr/bin/env bash
# Generates the unit table body for private/review/coverage/LEDGER.md (Phase 0a).
# Run from repo root. Prints markdown rows: | id | path | files | status |
set -euo pipefail

count_files() {
	find "$1" -maxdepth "${2:-1}" \( -name '*.ts' -o -name '*.tsx' \) \
		! -name '*.test.ts' ! -name '*.test.tsx' ! -path '*/__tests__/*' 2>/dev/null | wc -l | tr -d ' '
}

emit_dir_units() { # $1 = root
	local root="$1"
	local n
	n=$(count_files "$root" 1)
	if [ "$n" -gt 0 ]; then
		echo "| U-$(echo "$root" | tr '/' '-') | \`$root/*.ts(x)\` (top-level files) | $n | UNREVIEWED |"
	fi
	for d in "$root"/*/; do
		[ -d "$d" ] || continue
		d="${d%/}"
		case "$d" in *__tests__*|*node_modules*|*dist*) continue ;; esac
		n=$(count_files "$d" 99)
		[ "$n" -gt 0 ] || continue
		echo "| U-$(echo "$d" | tr '/' '-') | \`$d/\` | $n | UNREVIEWED |"
	done
}

echo "### Core"
for root in src/core/task src/core/api src/core/controller src/core/context \
	src/core/hooks src/core/storage src/core/prompts src/core/workspace \
	src/core/permissions src/core/ignore; do
	[ -d "$root" ] || continue
	emit_dir_units "$root"
done

echo
echo "### Providers (one row per handler file)"
for f in src/core/api/providers/*.ts; do
	case "$f" in *.test.ts) continue ;; esac
	echo "| P-$(basename "$f" .ts) | \`$f\` | 1 | UNREVIEWED |"
done

echo
echo "### Tools (one row per tool module)"
for d in src/core/task/tools/modules/*/; do
	d="${d%/}"
	case "$d" in *__tests__*) continue ;; esac
	echo "| T-$(basename "$d") | \`$d/\` | $(count_files "$d" 99) | UNREVIEWED |"
done

echo
echo "### Integrations / services / hosts / shared / utils"
for root in src/integrations src/services src/hosts src/shared src/utils; do
	emit_dir_units "$root"
done

echo
echo "### Webview"
for root in webview-ui/src/app webview-ui/src/features webview-ui/src/entities webview-ui/src/shared; do
	emit_dir_units "$root"
done

echo
echo "### CLI"
for root in cli/src/acp cli/src/agent cli/src/commands cli/src/components cli/src/hooks cli/src/services; do
	[ -d "$root" ] || continue
	emit_dir_units "$root"
done
