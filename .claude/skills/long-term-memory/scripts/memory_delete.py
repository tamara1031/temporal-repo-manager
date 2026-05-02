#!/usr/bin/env python3
"""Delete knowledge from long-term memory."""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Delete knowledge from long-term memory"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--id", type=str, help="Single memory ID to delete")
    group.add_argument(
        "--ids", type=str, help="Comma-separated memory IDs to delete"
    )
    group.add_argument(
        "--tag", type=str, help="Delete all memories with this tag"
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Skip confirmation for bulk deletes (required for --tag)",
    )
    args = parser.parse_args()

    collection = _common.get_collection()

    if args.id:
        existing = collection.get(ids=[args.id])
        if not existing.get("ids"):
            print(f"Memory with ID '{args.id}' not found.")
            return
        collection.delete(ids=[args.id])
        print(f"Deleted memory: {args.id}")

    elif args.ids:
        id_list = [i.strip() for i in args.ids.split(",") if i.strip()]
        existing = collection.get(ids=id_list)
        found_ids = existing.get("ids", [])
        if not found_ids:
            print("None of the specified IDs were found.")
            return
        collection.delete(ids=found_ids)
        print(f"Deleted {len(found_ids)} memory(ies):")
        for doc_id in found_ids:
            print(f" - {doc_id}")

    elif args.tag:
        tag_filter = _common.build_tag_filter([args.tag])
        if not tag_filter:
            print("Invalid tag.", file=sys.stderr)
            sys.exit(1)

        existing = collection.get(
            where=tag_filter, include=["documents"], limit=10000
        )
        found_ids = existing.get("ids", [])
        if not found_ids:
            print(f"No memories found with tag '{args.tag}'.")
            return

        if not args.confirm:
            docs = existing.get("documents", [])
            print(f"Found {len(found_ids)} memory(ies) with tag '{args.tag}':")
            for doc_id, doc in zip(found_ids, docs):
                preview = doc[:80] + "..." if len(doc) > 80 else doc
                print(f"  {doc_id}: {preview}")
            print(
                "\nRe-run with --confirm to delete these memories."
            )
            return

        collection.delete(ids=found_ids)
        print(f"Deleted {len(found_ids)} memory(ies) with tag '{args.tag}'.")

if __name__ == "__main__":
    main()