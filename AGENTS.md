# Agent guide

This repo packages Orca's headless server (`orca-ide serve`) as an umbrelOS app: a
container image (`image/`), a dependency-free Node.js companion with a status page
(`image/companion/`), and the Umbrel app package (`yanffernandes-orca/`). Read
CONTRIBUTING.md before changing anything; it is the source of truth for layout and rules.

## Commands

```sh
node --test image/companion/test/*.test.mjs        # unit tests
scripts/local-test.sh                              # build + run at http://localhost:16769
scripts/smoke-test.sh umbrel-orca-server:local     # end-to-end check of an image
```

## Rules

- No npm dependencies in the companion; Node.js 24 standard library, ES modules.
- The status page has no build step and must work over plain `http://`.
- Never log, print, or commit an `orca://pair` link, a device token, or the app password.
- Persist state only under `/home/orca`.
- Do not hand-edit the app `version`, image tags, or digests; `.github/workflows/release.yml`
  owns them.
- Never change the app ids (`yanffernandes-orca`, and `orca-server` in the official store)
  or the store id (`yanffernandes`): installed apps keep their data under the id.
- Workarounds for Orca bugs link the upstream issue and switch themselves off once fixed.
- When a change affects setup, ports, user-visible behavior, or releases, update README.md
  and CONTRIBUTING.md in the same change.

## Before you finish

Run the unit tests. For changes to the image or companion, also build the image and run the
smoke test, and say in the pull request what you ran.
