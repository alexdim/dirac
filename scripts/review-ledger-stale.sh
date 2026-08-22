#!/usr/bin/env bash
# Prints REVIEWED ledger units touched since the private ledger was updated.
# Run from the repository root. Pass a ledger path or set LEDGER_PATH to override
# the default private/review/coverage/LEDGER.md symlink.
set -euo pipefail

ledger_path="${1:-${LEDGER_PATH:-private/review/coverage/LEDGER.md}}"

if [ ! -f "$ledger_path" ]; then
	echo "Ledger not found: $ledger_path" >&2
	exit 1
fi

if ledger_mtime=$(stat -c '%Y' -- "$ledger_path" 2>/dev/null); then
	:
else
	ledger_mtime=$(stat -f '%m' -- "$ledger_path")
fi

if since=$(date -u -d "@$ledger_mtime" '+%Y-%m-%d %H:%M:%S %z' 2>/dev/null); then
	:
else
	since=$(date -u -r "$ledger_mtime" '+%Y-%m-%d %H:%M:%S %z')
fi

is_production_path() {
	case "$1" in
		*/__tests__/*|*.test.ts|*.test.tsx)
			return 1
			;;
	esac
	return 0
}

matches_unit_path() {
	local file="$1"
	local spec="$2"
	local base

	if [[ "$spec" =~ ^(.*)/\*\.ts\(x\)$ ]]; then
		base="${BASH_REMATCH[1]}"
		[[ "$file" =~ ^${base}/[^/]+\.tsx?$ ]]
		return
	fi

	if [[ "$spec" == */ ]]; then
		[[ "$file" == "${spec}"* ]]
		return
	fi

	[[ "$file" == "$spec" ]]
}

declare -A stale_units=()

while IFS= read -r touched_file; do
	[ -n "$touched_file" ] || continue
	is_production_path "$touched_file" || continue

	while IFS=$'\t' read -r unit_id path_spec; do
		[ -n "$unit_id" ] || continue
		if matches_unit_path "$touched_file" "$path_spec"; then
			stale_units["$unit_id"]=1
		fi
	done < <(
		awk -F'|' '
			$0 ~ /^\|/ {
				id = $2
				status = $5
				gsub(/^[[:space:]]+|[[:space:]]+$/, "", id)
				gsub(/^[[:space:]]+|[[:space:]]+$/, "", status)
				if (status != "REVIEWED") next

				paths = $3
				while (match(paths, /`[^`]+`/)) {
					spec = substr(paths, RSTART + 1, RLENGTH - 2)
					printf "%s\t%s\n", id, spec
					paths = substr(paths, RSTART + RLENGTH)
				}
			}
		' "$ledger_path"
	)
done < <(git log --since="$since" --name-only --format= | awk 'NF' | sort -u)

if [ "${#stale_units[@]}" -eq 0 ]; then
	exit 0
fi

printf '%s\n' "${!stale_units[@]}" | sort
