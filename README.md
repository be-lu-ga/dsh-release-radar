# dsh-release-radar

English | [简体中文](README.zh.md)

Plugins installed into DSH do not all follow the app's own release train. This plugin watches them for you: every 24 hours it sweeps the profile, and when something is behind it floats a small badge in the bottom-right corner. Open it to see how far each plugin lags, and update one at a time.

**Nothing installs without your click.**

## The problem it solves

DSH's own plugin page tells you about new versions only **when you go look**. With a dozen third-party plugins installed, nobody opens that page every day — so a plugin quietly falls several versions behind until the day it breaks.

Release Radar turns that into background work: it scans on its own, appears only when there is a result, and takes no space otherwise.

## When it checks

- About 20 seconds after DSH starts.
- Every 24 hours after that.
- "Check again" in the panel runs a check on demand.

A restart does not blank the badge: the last report is cached in the profile directory, restored on a cold start, and replaced once the sweep lands.

## What gets checked

Only **third-party bundles installed in this profile**:

| Source | Handling |
| --- | --- |
| registry (`name@version`) | Lists published versions, reports anything higher than what is installed |
| GitHub (`github:user/repo`) | Reads the commit pinned in `pnpm-lock.yaml` and compares it with the remote `HEAD` |
| local `link:` / `file:` | Skipped (local is already current) |
| prereleases | Skipped by default; opt in through config |
| bundled `@deepseek-ai/*` | Follows the DSH release and is never listed here |

Version comparison is numeric: `0.4.9 < 0.4.10` and `1.0.0-rc.1 < 1.0.0`. Comparing as strings would sort `0.4.10` below `0.4.9`.

## What "Update" does

It calls DSH's own `pluginManager.updateBundle()` — exactly what the plugin page's update button does:

1. Verifies on the registry that the target version exists, declares a bundle, and accepts the running DSH version.
2. On failure nothing changes and the badge reports the error.
3. On success it installs, then re-scans.

`updateBundle()` does not throw on a refused update; it resolves with a result carrying `application: 'failed' | 'cancelled'`. This plugin inspects that field before reporting success — otherwise a failed update would be displayed as "updated", which is a lie.

## Why some rows have no Update button

For Git installs the package version usually does not change with a commit, and DSH requires the target version to be strictly higher than the installed one. Those cannot be updated inline; the row is labeled "Installed from Git — update manually" and still shows which commits it is behind.

That is deliberate. A button that is guaranteed to fail is worse than no button.

## Configuration

```yml
- insert:
    - id: dsh-release-radar
      name: dsh-release-radar
      config:
        intervalHours: 24        # 1 .. 336
        startDelayMs: 3000       # delay before the first sweep
        includePrerelease: false # count -rc / -beta releases
        diagnostics: false       # have the panel report what it rendered
```

## Install

```bash
pnpm add github:be-lu-ga/dsh-release-radar
```

Then add `dsh-release-radar` to `dsh.profile.bundles` in the profile manifest and restart DSH.

## Turning it off

The badge stops appearing and no background checks run. Plugins you already installed are unaffected.

## Development

```
lib/index.js    host half: sweep, version compare, routes, install
lib/client.js   client half: the corner badge and panel
locale/         zh / en copy and plugin-page description
docs/           plugin-page preview and details
selftest.mjs    harness-free client render tests
host-test.mjs   host-half pure functions and profile discovery
```

```bash
node selftest.mjs
node host-test.mjs
```

Neither test needs a DSH runtime: the client test stubs the module loader, React and `document`; the host test runs only pure functions.

## Known limits

- Registry and GitHub are the only source shapes recognised; other Git hosts (GitLab, self-hosted) are not classified yet.
- "Behind" for Git installs is commit equality, not ancestry; a force-pushed branch can re-raise a notice.
- The badge lives in the `shell.overlay` slot and shares the bottom-right corner with other overlays, so very crowded layouts can overlap.

## License

MIT
