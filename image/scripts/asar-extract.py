"""Copy files out of an Electron app.asar archive without Node or npm.

Usage:
  asar-extract.py <app.asar> <dest-root> <path-in-asar> [<path-in-asar> ...]

Each path may name a file or a directory (extracted recursively). Output keeps
the in-archive layout under <dest-root>. Entries the archive marks as
"unpacked" already live in app.asar.unpacked and are copied from there.
"""

import json
import os
import shutil
import struct
import sys


def read_header(archive):
    archive.seek(0)
    prefix = archive.read(16)
    # Chromium pickle: [4 size][4 header size][4 payload size][4 json length]
    header_size = struct.unpack("<I", prefix[4:8])[0]
    json_length = struct.unpack("<I", prefix[12:16])[0]
    header = json.loads(archive.read(json_length).decode("utf-8"))
    return header, 8 + header_size


def lookup(node, parts):
    for part in parts:
        files = node.get("files")
        if files is None or part not in files:
            raise KeyError("/".join(parts))
        node = files[part]
    return node


def walk(node, parts):
    if "files" in node:
        for name, child in node["files"].items():
            yield from walk(child, parts + [name])
    else:
        yield parts, node


def extract(archive_path, dest_root, in_archive):
    parts = [p for p in in_archive.strip("/").split("/") if p]
    unpacked_root = archive_path + ".unpacked"
    count = 0
    with open(archive_path, "rb") as archive:
        header, data_offset = read_header(archive)
        for entry_parts, entry in walk(lookup(header, parts), parts):
            if "link" in entry:
                continue
            relative = os.path.join(*entry_parts)
            target = os.path.join(dest_root, relative)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if entry.get("unpacked"):
                shutil.copyfile(os.path.join(unpacked_root, relative), target)
            else:
                archive.seek(data_offset + int(entry["offset"]))
                with open(target, "wb") as out:
                    out.write(archive.read(int(entry["size"])))
            if entry.get("executable"):
                os.chmod(target, 0o755)
            count += 1
    print(f"asar-extract: {in_archive} -> {dest_root} ({count} files)")


def main(argv):
    if len(argv) < 4:
        print(__doc__, file=sys.stderr)
        return 64
    archive_path, dest_root = argv[1], argv[2]
    for in_archive in argv[3:]:
        extract(archive_path, dest_root, in_archive)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
