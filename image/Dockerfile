# Orca Server for umbrelOS: the official Orca Linux package running `orca-ide serve`
# headless, plus a small companion web app for pairing, status, and agent setup.

ARG UBUNTU_IMAGE=ubuntu:noble-20260917
ARG NODE_IMAGE=node:24.21.0-bookworm-slim

FROM ${NODE_IMAGE} AS node

FROM ${UBUNTU_IMAGE}

# Bumped together by .github/workflows/image.yml when a new Orca release ships.
ARG ORCA_VERSION=1.4.227
ARG ORCA_DEB_SHA256_AMD64=0891b7dde996a815660ea0c1d5b01979067501231ddbdc40bcbd223181b63112
ARG ORCA_DEB_SHA256_ARM64=6b3f08d070fe49b0f78eaa78c64dcf9781051e23b79d302bf4ea910877ba09a1
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Tools coding agents expect on a dev server. libasound2t64 is loaded by Orca's
# Electron binary (used as the CLI's Node runtime) but is missing from the .deb's
# dependency list.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash-completion build-essential bzip2 ca-certificates curl dnsutils git git-lfs \
      gnupg htop iproute2 iputils-ping jq less libasound2t64 lsof nano openssh-client \
      pkg-config procps psmisc python3 python3-pip python3-venv ripgrep sudo tini \
      tmux tree tzdata unzip vim-tiny wget xz-utils zip \
 && rm -rf /var/lib/apt/lists/*

# GitHub CLI, from GitHub's apt repository.
RUN install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
      https://cli.github.com/packages/githubcli-archive-keyring.gpg \
 && chmod a+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# Node.js runs the companion app and npm-distributed agent CLIs.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
 && node --version && npm --version

# Orca itself: the official .deb from GitHub Releases, checked against its sha256.
RUN set -eu; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$arch" in \
      amd64) sha="$ORCA_DEB_SHA256_AMD64" ;; \
      arm64) sha="$ORCA_DEB_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/orca.deb \
      "https://github.com/stablyai/orca/releases/download/v${ORCA_VERSION}/orca-ide_${ORCA_VERSION}_${arch}.deb"; \
    echo "${sha}  /tmp/orca.deb" | sha256sum -c -; \
    apt-get update; \
    apt-get install -y --no-install-recommends /tmp/orca.deb; \
    rm -rf /tmp/orca.deb /var/lib/apt/lists/*; \
    test "$(dpkg-query -W -f='${Version}' orca-ide)" = "$ORCA_VERSION"

COPY scripts/asar-extract.py /usr/local/lib/orca-umbrel/asar-extract.py

# Two files Orca keeps inside app.asar that a headless container needs on disk:
#  - the orcad selection entry: `orca-ide serve` runs it with ELECTRON_RUN_AS_NODE,
#    which can't read app.asar, so serve falls back to Electron (and Chromium's
#    sandbox can't start in Docker). stablyai/orca#27307; skipped once upstream
#    unpacks it.
#  - the browser client bundle: only Electron serve hosts it, so the companion app
#    serves it for orcad.
RUN set -eu; \
    res=/opt/Orca/resources; \
    entry=out/main/orcad/orcad-local-serve-selection-entry.js; \
    if [ ! -f "$res/app.asar.unpacked/$entry" ]; then \
      python3 -I /usr/local/lib/orca-umbrel/asar-extract.py "$res/app.asar" "$res/app.asar.unpacked" "$entry"; \
    fi; \
    python3 -I /usr/local/lib/orca-umbrel/asar-extract.py "$res/app.asar" /opt/orca-umbrel/web-client out/web; \
    test -f /opt/orca-umbrel/web-client/out/web/web-index.html

# umbrelOS runs app containers as 1000:1000 and owns their data that way. Ubuntu's
# image ships a `ubuntu` user on that UID; replace it with `orca`. Passwordless sudo
# lets agents install system packages (they last until the container is recreated).
RUN userdel --remove ubuntu 2>/dev/null || true \
 && groupadd --gid 1000 orca \
 && useradd --uid 1000 --gid 1000 --home-dir /home/orca --create-home --shell /bin/bash orca \
 && echo 'orca ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/orca \
 && chmod 0440 /etc/sudoers.d/orca \
 && printf '%s\n' \
      '# Agent CLIs installed into the persistent home (see the image ENV PATH).' \
      'for dir in "$HOME/.opencode/bin" "$HOME/.npm-global/bin" "$HOME/.local/bin"; do' \
      '  case ":$PATH:" in *":$dir:"*) ;; *) PATH="$dir:$PATH" ;; esac' \
      'done' \
      'export PATH' \
      > /etc/profile.d/orca-umbrel-path.sh

COPY companion /opt/orca-umbrel/companion

# Agent CLIs install into the persistent home, so they survive updates and can
# update themselves.
ENV HOME=/home/orca \
    USER=orca \
    SHELL=/bin/bash \
    NPM_CONFIG_PREFIX=/home/orca/.npm-global \
    PATH=/home/orca/.local/bin:/home/orca/.npm-global/bin:/home/orca/.opencode/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    ORCA_PORT=6768 \
    COMPANION_PORT=8080 \
    ORCA_UMBREL_ORCA_VERSION=${ORCA_VERSION} \
    ORCA_UMBREL_WEB_CLIENT_DIR=/opt/orca-umbrel/web-client/out/web

LABEL org.opencontainers.image.title="Orca Server for umbrelOS" \
      org.opencontainers.image.description="Headless Orca runtime (orca serve) with a pairing and status page" \
      org.opencontainers.image.source="https://github.com/yanffernandes/umbrel-orca-server" \
      org.opencontainers.image.version="${ORCA_VERSION}"

USER orca
WORKDIR /home/orca
EXPOSE 6768 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=3m --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${COMPANION_PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/opt/orca-umbrel/companion/server.mjs"]
