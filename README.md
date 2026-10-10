# Orca Server for umbrelOS

An [Umbrel](https://umbrel.com) community app store with one app: a headless
[Orca](https://github.com/stablyai/orca) server. Projects, worktrees, terminals, and agent
sessions live on your Umbrel and keep running while your laptop sleeps. You drive them
from the Orca desktop app or from Orca's web client in a browser.

## Install

1. In umbrelOS, open the **App Store**, click **⋯** (top right), then **Community App Stores**.
2. Paste `https://github.com/yanffernandes/umbrel-orca-server` and click **Add**.
3. Open the **Yan Fernandes** store and install **Orca Server**.

## Connect Orca Desktop

1. Open **Orca Server** from the Umbrel home screen and sign in with the app password
   umbrelOS shows you.
2. Pick the address your computer uses to reach the Umbrel: `umbrel.local` on your home
   network, or the Umbrel's Tailscale IP or MagicDNS name to also work away from home.
3. Copy the access link.
4. In Orca, open **Settings → Remote Orca Servers → Add Server**, paste the link, and add it.

Each link pairs one client. Use **Create new link** on the page to pair another computer,
and **Revoke** under **Paired clients** to cut one off.

**Open Orca Web** on the same page opens Orca's browser client, connected to the server
through the app's own address (so it also works when umbrelOS serves the app over HTTPS).

## Agents

Agents run on the Umbrel, under the Umbrel's own sign-ins. Install Claude Code, Codex, or
OpenCode from the app page (or any other CLI from an Orca terminal), then sign in by
starting it in an Orca terminal on the server, for example `claude`, or
`codex login --device-auth`. For GitHub, run `gh auth login`.

The container has git, the GitHub CLI, Node.js 24, Python 3, and build tools.

## What is kept

Everything under the home directory, `/home/orca`, which lives in the app's data folder:
Orca's state and paired clients, cloned repositories and worktrees, agent CLIs and their
sign-ins, shell and git configuration. Packages installed with `sudo apt-get` are gone when
the container is recreated (app updates and restarts from umbrelOS).

## Security

- Orca clients connect directly to port **6768**. Every client authenticates with its own
  revocable token from an access link. Keep the port on your LAN or tailnet. Do not
  forward it to the internet.
- An access link gives full control of the server, including a shell. Treat it like a
  password.
- The status page is behind umbrelOS's login and also asks for the app's own password,
  because other containers on the Umbrel can reach it without going through the login.

## How it works

The image installs the official `orca-ide` Linux package and runs `orca-ide serve`, which
starts Orca's headless Node runtime (orcad) on port 6768. A small companion app
(`image/companion`, plain Node.js, no dependencies) supervises it and serves the status
page on port 8080, which umbrelOS exposes as the app (port 6769). The companion:

- reads the pairing offer Orca prints at startup and rewrites its address for the client;
- mints new links and revokes clients by restarting Orca around an edit of its client
  registry (terminals survive, since Orca's terminal daemon keeps running);
- serves Orca's web client bundle and relays its WebSocket to Orca;
- installs agent CLIs into the persistent home.

Two workarounds live in the Dockerfile. Orca 1.4.224 keeps the file `orca-ide serve` uses
to pick orcad inside `app.asar`, out of reach of the CLI, so serve falls back to Electron,
whose sandbox cannot start in Docker
([stablyai/orca#27307](https://github.com/stablyai/orca/issues/27307)); the image copies
that file out. Orca only bundles the web client for Electron serve, so the image copies
that out too for the companion to serve.

## Try it locally

With Docker:

```sh
scripts/local-test.sh
```

Then open <http://localhost:16769> (password `local-test-password`). The access link works
from Orca on the same machine. Locally the ports are 16768 and 16769, since Orca Desktop
already listens on 6768.

## Releases

- `.github/workflows/release.yml` runs daily. When Orca ships a new release, it builds
  the image for amd64 and arm64, smoke-tests it, pushes it to GHCR, and commits the new
  version and image digest to the app package, which makes umbrelOS offer the update.
- Run that workflow by hand to package a specific Orca version, or to re-release the
  current one as `-patch.N` after changing the image.
- `.github/workflows/ci.yml` runs the unit tests and the smoke test on every change.

The first push creates the `umbrel-orca-server` package on GHCR. If GitHub makes it
private, set its visibility to public under the package's settings; umbrelOS pulls
without credentials.

## Credits

Orca is made by [Stably AI](https://github.com/stablyai) and released under the MIT
license; the app icon is Orca's. This repository only packages it for umbrelOS.
