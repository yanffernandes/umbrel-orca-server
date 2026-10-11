"""Write the official Umbrel App Store version of the app package.

Usage:
  make-official-package.py <umbrel-apps checkout> [--app-id orca-server] [--submission <PR url>]

The community store package (yanffernandes-orca/) stays the single source. The
copy for getumbrel/umbrel-apps differs only where the official store asks it to:

- the app id has no store prefix (directory, manifest `id`, app_proxy APP_HOST);
- no `icon`, since Umbrel hosts the icons of official apps;
- `releaseNotes` is empty for a first submission;
- `submission` points at the umbrel-apps pull request, once it exists.
"""

import argparse
import pathlib
import re
import shutil
import sys

SOURCE_ID = "yanffernandes-orca"
SOURCE = pathlib.Path(__file__).resolve().parent.parent / SOURCE_ID


def replace_once(pattern, replacement, text, label):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        raise SystemExit(f"make-official-package: could not find {label}")
    return updated


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("umbrel_apps", type=pathlib.Path, help="path to a getumbrel/umbrel-apps checkout")
    parser.add_argument("--app-id", default="orca-server")
    parser.add_argument("--submission", help="URL of the umbrel-apps pull request")
    args = parser.parse_args(argv[1:])

    if not (args.umbrel_apps / ".agents").is_dir():
        raise SystemExit(f"{args.umbrel_apps} does not look like a getumbrel/umbrel-apps checkout")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*[a-z0-9]", args.app_id):
        raise SystemExit("--app-id must be lowercase kebab-case")

    target = args.umbrel_apps / args.app_id
    is_new = not target.exists()
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(SOURCE, target)

    manifest = target / "umbrel-app.yml"
    text = manifest.read_text()
    text = replace_once(r"^id: .*?$", f"id: {args.app_id}", text, "id")
    text = replace_once(r"^icon: .*?\n", "", text, "icon")
    if is_new:
        # The value runs until the blank line that precedes the next block of keys.
        text = replace_once(r"^releaseNotes:.*?\n(?=\n\S)", 'releaseNotes: ""\n', text, "releaseNotes")
    if args.submission:
        text = replace_once(r"^submission: .*?$", f"submission: {args.submission}", text, "submission")
    manifest.write_text(text)

    compose = target / "docker-compose.yml"
    text = compose.read_text()
    text = replace_once(
        rf"^(\s+APP_HOST: ){re.escape(SOURCE_ID)}_", rf"\g<1>{args.app_id}_", text, "APP_HOST"
    )
    compose.write_text(text)

    print(f"{'created' if is_new else 'updated'} {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
