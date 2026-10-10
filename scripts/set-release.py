"""Point the Umbrel package at a released image.

Usage: set-release.py <app version> <image reference> <release notes>

Sets `version` and `releaseNotes` in umbrel-app.yml and the server image in
docker-compose.yml. umbrelOS offers the update when `version` changes.
"""

import pathlib
import re
import sys

PACKAGE = pathlib.Path(__file__).resolve().parent.parent / "yanffernandes-orca"


def replace_once(pattern, replacement, text, label):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        raise SystemExit(f"set-release: could not find {label}")
    return updated


def folded(notes):
    # Two newlines make a paragraph break in umbrelOS's folded YAML.
    paragraphs = [p.strip() for p in notes.strip().split("\n\n") if p.strip()]
    body = "\n\n\n".join("  " + " ".join(p.split()) for p in paragraphs)
    return f"releaseNotes: >-\n{body}\n"


def main(argv):
    if len(argv) != 4:
        print(__doc__, file=sys.stderr)
        return 64
    version, image, notes = argv[1:]

    manifest = PACKAGE / "umbrel-app.yml"
    text = manifest.read_text()
    text = replace_once(r'^version: .*?$', f'version: "{version}"', text, "version")
    # The value runs until the blank line that precedes the next block of keys.
    text = replace_once(r"^releaseNotes:.*?\n(?=\n\S)", folded(notes), text, "releaseNotes")
    manifest.write_text(text)

    compose = PACKAGE / "docker-compose.yml"
    text = compose.read_text()
    text = replace_once(r"^(\s+image: )ghcr\.io/\S+$", rf"\g<1>{image}", text, "server image")
    compose.write_text(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
