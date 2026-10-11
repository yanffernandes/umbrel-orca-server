# Security policy

## Reporting a vulnerability

Report security problems privately: open this repository's **Security** tab and choose
**Report a vulnerability**. Please do not open a public issue for them.

Include what you found, how to reproduce it, and the app version you tested (shown at the
bottom of the status page).

Vulnerabilities in Orca itself go to its developers:
[stablyai/orca security](https://github.com/stablyai/orca/security).

## Scope

- The status page and its API: the app password, access links, and revoking clients.
- The WebSocket relay to Orca.
- The container image: users, `sudo`, ports, and what it installs.
- The release pipeline that builds and publishes the image.

## Secrets in reports

Never paste access links (`orca://pair?...`), device tokens, or app passwords into issues,
logs, or screenshots. If a link leaked, revoke it under **Paired clients** on the status
page, or use **Replace link** if it was never used.
