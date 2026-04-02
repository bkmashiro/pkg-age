[![npm](https://img.shields.io/npm/v/pkg-age)](https://www.npmjs.com/package/pkg-age) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# pkg-age

`pkg-age` is a CLI that inspects the health of your npm dependencies by checking their latest release date, major version drift, and deprecation status from the npm registry.

## Install

```bash
npm i -g pkg-age
```

## Usage

```bash
pkg-age
pkg-age --cwd ~/projects/my-app
pkg-age --deprecated-only
pkg-age --no-dev
pkg-age --json
pkg-age --sort age
pkg-age --watch
pkg-age --watch --interval 3600
pkg-age --update-check
pkg-age --risk-score
pkg-age --alternatives
```

Example output:

```text
Checking 6 dependencies...

Package  Current  Latest  Age          Status
chalk    5.3.0    5.6.2   4 months ago ✓ active
moment   2.29.4   2.29.4  1 year ago   ✗ DEPRECATED -> This package is in maintenance mode
```

## Options

- `--cwd <path>`: project directory to inspect, default is the current working directory
- `--json`: emit JSON output
- `--deprecated-only`: only show deprecated packages
- `--no-dev`: skip `devDependencies`
- `--sort <field>`: sort by `age`, `name`, or `status`
- `--watch`: keep checking packages and only report status transitions
- `--interval <seconds>`: polling interval for `--watch`, default `86400`
- `--update-check`: show patch/minor/major upgrade categories and grouped `npm install` commands
- `--risk-score`: calculate a per-package risk score from release age, maintenance signals, and npm security advisories
- `--alternatives`: suggest curated replacements for risky packages with known modern substitutes

## How It Works

`pkg-age` reads `dependencies` and `devDependencies` from your `package.json`, fetches metadata from `https://registry.npmjs.org/<pkg>`, and evaluates each package using:

- `dist-tags.latest`
- `time[latest]`
- `versions[latest].deprecated`

The CLI then marks packages as deprecated, unmaintained, old, outdated, or active and sorts them by severity.

For Round 3 analysis modes, `pkg-age` also queries npm's bulk security advisory endpoint to fold known advisories into package risk scores and replacement suggestions.

## Compared With `npm outdated`

`npm outdated` shows version drift. `pkg-age` adds release age and deprecation signals so you can spot stale packages even when you are technically on the latest version.
