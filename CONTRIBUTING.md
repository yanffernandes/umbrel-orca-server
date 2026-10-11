# Contributing

Thanks for helping. This repository packages [Orca](https://github.com/stablyai/orca) for
umbrelOS: a container image that runs Orca's headless server, a small companion app with
a status page, and the Umbrel app package that installs them.

## Where things belong

- **Orca itself** (agents, terminals, the desktop or web app, pairing protocol):
  [stablyai/orca](https://github.com/stablyai/orca/issues).
- **This package** (installing on Umbrel, the status page, access links, the image,
  updates): [open an issue here](https://github.com/yanffernandes/umbrel-orca-server/issues/new/choose).
- **Security problems**: report them privately, as described in [SECURITY.md](SECURITY.md).

Useful contributions include testing on hardware we have not covered (Raspberry Pi 4 and
5, x86 boxes, umbrelOS versions), fixing bugs, improving the status page, removing a
workaround once Orca fixes the underlying issue, and improving these docs.

## Repository layout

```text
umbrel-app-store.yml           Community app store id and name
yanffernandes-orca/            The Umbrel app package (manifest, compose, data dirs)
image/
  Dockerfile                   Ubuntu + Orca's .deb + agent tooling + companion
  scripts/asar-extract.py      Copies files out of Orca's app.asar at build time
  companion/
    server.mjs                 HTTP server: status API, static UI, WebSocket relay
    lib/orca-serve.mjs         Runs and restarts `orca-ide serve`, reads its ready line
    lib/pairing.mjs            Decodes and re-addresses Orca pairing links
    lib/devices.mjs            Reads and edits Orca's paired-client registry
    lib/auth.mjs               App-password sessions for the status API
    lib/agents.mjs             Detects and installs agent CLIs
    public/                    The status page (plain HTML, CSS, and JS)
    test/                      Unit tests (node:test)
scripts/
  local-test.sh                Build and run the image like umbrelOS would
  smoke-test.sh                Start an image and check the main flows end to end
  set-release.py               Point the package at a released image (used by CI)
  make-official-package.py     Build the getumbrel/umbrel-apps version of the package
.github/workflows/
  ci.yml                       Unit tests, image build, smoke test, and Umbrel's linter
  release.yml                  Daily: package new Orca releases and publish the image
```

## Development

You need Docker, Node.js 24 or newer, Python 3, `curl`, and `jq`.

```sh
# Unit tests for the companion
node --test image/companion/test/*.test.mjs

# Build the image and run it at http://localhost:16769 (password: local-test-password).
# Orca clients reach it on port 16768. Locally the ports are not Umbrel's 6768 and 6769
# because Orca Desktop already listens on 6768 on the machine it runs on.
scripts/local-test.sh

# End-to-end check of an image: Orca starts, the API needs the password, an access link
# is handed out and re-addressed, the web client is served, and no link reaches the logs
scripts/smoke-test.sh umbrel-orca-server:local
```

`scripts/local-test.sh` keeps the home directory in the `orca-umbrel-local-home` Docker
volume between runs. To start over:
`docker rm -f orca-umbrel-local && docker volume rm orca-umbrel-local-home`.

To pair a real Orca client with your local build, open the status page, choose
`localhost`, copy the link, and add it in Orca under
**Settings → Remote Orca Servers → Add Server**.

If your Docker has no BuildKit (`docker buildx` missing), the scripts fall back to the
classic builder.

## How the code is written

- **No npm dependencies in the companion.** It runs on Node.js 24's standard library
  only, which keeps the image small and the supply chain short. Use ES modules.
- **The status page has no build step.** Plain HTML, CSS, and JavaScript, served under a
  same-origin Content Security Policy. It must work over plain `http://`, where the
  Clipboard API and other secure-context features are missing.
- **Access links are secrets.** Never log them (`lib/log.mjs` redacts `orca://pair` links)
  and never return a link that a client has already used. Keep the app password out of
  child processes' environment.
- **State lives in `/home/orca` only.** Anything users expect to keep must be under the
  home directory, which umbrelOS persists. The container filesystem is recreated on every
  update.
- **Follow Orca, don't fork it.** Prefer using Orca's own commands and formats. When a
  workaround is unavoidable, link the upstream issue next to it and make it switch itself
  off once Orca is fixed, like the `app.asar` extraction in the Dockerfile.
- **Keep the docs true.** If a change affects setup, ports, behavior users see, or the
  release process, update README.md and this file in the same pull request.

## Pull requests

1. Fork the repository and create a branch.
2. Make focused changes, with tests for new companion logic.
3. Run the unit tests and the smoke test. If you changed anything users see, run the image
   with `scripts/local-test.sh` and try it, ideally with a real Orca client.
4. Open a pull request that says what changed, why, and how you tested it. CI must pass.

Do not edit the app `version`, image tags, or digests by hand; the release workflow owns
them.

## Releases

The [release workflow](.github/workflows/release.yml) runs every day. When Orca publishes
a new release, it updates the Dockerfile to that version (with the `.deb` checksums from
GitHub), runs the unit and smoke tests, builds the image for `amd64` and `arm64`, pushes it
to `ghcr.io/yanffernandes/umbrel-orca-server`, and commits the new version and image
digest to `yanffernandes-orca/`. umbrelOS then offers the update to everyone using the
community store.

Changes to the image itself ship when a maintainer runs the workflow by hand. With the same
Orca version, that publishes `<version>-patch.N`, following Umbrel's convention for
packaging-only releases.

## Official Umbrel App Store

The official store is [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps).
Apps get there through a pull request that the Umbrel team reviews, following the guides in
that repository's `.agents/skills/` (`umbrel-package-app`, `umbrel-test-app`, and
`umbrel-update-app`). In the official store the app id is `orca-server`.

To prepare a submission or an update:

```sh
git clone https://github.com/getumbrel/umbrel-apps.git
python3 scripts/make-official-package.py umbrel-apps --app-id orca-server \
  --submission https://github.com/getumbrel/umbrel-apps/pull/<number>
cd umbrel-apps && npm ci && npm run lint:apps -- orca-server --check-images
```

The script copies `yanffernandes-orca/` and changes only what the official store requires:
the app id and container name, no `icon`, empty `releaseNotes` for a first submission, and
the `submission` link. Test the package through umbrelOS and fill in umbrel-apps' pull
request template, including screenshots and the architectures tested.

Every update in the official store is a reviewed pull request, so it moves slower than the
community store. That is fine for users: Orca keeps clients and servers compatible across
versions, so a server a few releases behind still works with an up-to-date desktop app.
Submit updates when they matter (security fixes, features users ask for, or about once a
month), not for every Orca release.

## License

By contributing, you agree that your contributions are licensed under the repository's
[MIT license](LICENSE).
