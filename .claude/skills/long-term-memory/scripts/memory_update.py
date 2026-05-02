#!/usr/bin/env python3
"""Update knowledge in long-term memory."""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Update knowledge in long-term memory"
    )
    parser.add_argument("--id", type=str, required=True, help="Memory ID to update")
    parser.add_argument("--text", type=str, help="New text content")
    parser.add_argument(
        "--tags",
        type=str,
        help="New tags (comma-separated, replaces existing tags)",
    )
    parser.add_argument("--source", type=str, help="New source identifier")
    args = parser.parse_args()

    if not args.text and args.tags is None and args.source is None:
        print(
            "ERROR: At least one of --text, --tags, or --source must be provided.",
            file=sys.stderr,
        )
        sys.exit(1)

    collection = _common.get_collection()

    # Verify document exists
    existing = collection.get(ids=[args.id], include=["metadatas"])
    if not existing.get("ids"):
        print(f"ERROR: Memory with ID '{args.id}' not found.", file=sys.stderr)
        sys.exit(1)

    # Build updated metadata
    meta: dict = dict(existing["metadatas"][0]) if existing.get("metadatas") else {}
    now = datetime.now(timezone.utc).isoformat()
    meta["updated_at"] = now

    if args.tags is not None:
        # Remove old tag__ keys
        old_tag_keys = [k for k in meta if k.startswith("tag__")]
        for k in old_tag_keys:
            del meta[k]
        # Set new tags
        new_tags = [t.strip() for t in args.tags.split(",") if t.strip()]
        meta.update(_common.build_tag_metadata(new_tags))

    if args.source is not None:
        meta["source"] = args.source

    update_kwargs: dict = {"ids": [args.id], "metadatas": [meta]}
    if args.text:
        update_kwargs["documents"] = [args.text]

    collection.update(**update_kwargs)

    print(f"Updated memory: {args.id}")
    if args.text:
        preview = args.text[:100] + "..." if len(args.text) > 100 else args.text
        print(f"  New content: {preview}")
    if args.tags is not None:
        print(f"  New tags: {args.tags}")
    if args.source is not None:
        print(f"  New source: {args.source}")

if __name__ == "__main__":
    main()