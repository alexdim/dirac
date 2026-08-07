# Log retention policy

Dirac owns four persistent log families:

| Surface | Active file |
| --- | --- |
| IDE and external host | `dirac-ext.log` |
| CLI | `dirac-cli.log` |
| ACP | `dirac-acp.log` |
| CLI React crash reports | `crash.log` |

## Rotation and retention

Each family uses the same bounded layout:

- Active file: `name.log`
- Archives: `name.1.log` through `name.4.log`
- Maximum file size: 2 MiB
- Maximum files per family: 5, including the active file
- Maximum retained size per family: approximately 10 MiB
- Files older than 14 days are removed during initialization or the next write
- A single record larger than 2 MiB is truncated with an explicit marker
- Every newly written physical line begins with an ISO-8601 UTC timestamp; multi-line records receive the prefix on every line.

The active file always contains the newest records. Archive age increases with the numeric suffix, so `.4.log` is the oldest retained archive.

## Legacy migration

The first IDE, CLI, or ACP process using a log directory after this policy is introduced performs a versioned migration before opening its writer.

Legacy records are retained unchanged because their original timestamps cannot be inferred.

Migration is deliberately lossy:

1. Existing active and numbered files are treated as one chronological family.
2. At most the newest 10 MiB is read; older bytes are discarded by design.
3. A partial oldest record caused by tail selection is discarded.
4. Retained bytes are divided into at most five files of no more than 2 MiB each.
5. Prepared chunks are staged before replacing legacy files, and an interrupted installation is resumed on the next startup.
6. Obsolete `dirac.log` / `dirac.N.log` files are deleted.

The migration uses per-directory and per-family inter-process locks so IDE windows, CLI processes, and ACP processes cannot rotate or migrate the same family concurrently.

## Log directory resolution

All surfaces use this precedence:

1. `DIRAC_LOG_DIR`
2. `${DIRAC_DATA_DIR}/logs`
3. `${resolved data directory}/logs`, where the data directory incorporates `--config` or `DIRAC_DIR`
4. `~/.dirac/data/logs`

On Unix-like systems, the log directory is normalized to mode `0700` and persistent files to `0600`.

## Temporary command-output logs

Large and background command output is stored separately in the dedicated `dirac` system-temp subdirectory. Only files named `large-output-*.log` or `background-*.log` are managed there.

- Maximum age: 50 hours
- Aggregate size cap: 2 GiB
- Cleanup runs at startup and every 24 hours in IDE, CLI, and ACP modes

Temporary command-output logs are not part of the five-file persistent-family rotation policy.
