#!/usr/bin/env python3
"""Search / retrieve knowledge from long-term memory."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common

def main() -> None:
    parser = argparse.ArgumentParser(description="Search long-term memory")
    parser.add_argument(
        "--query", type=str, help="Search query text"
    )
    parser.add_argument(
        "--n-results", type=int, default=5, help="Number of results to return"
    )
    parser.add_argument(
        "--tags", type=str, help="Filter by tags (comma-separated, OR logic)"
    )
    parser.add_argument(
        "--json", action="store_true", dest="json_output", help="Output as JSON"
    )
    parser.add_argument(
        "--count", action="store_true", help="Show total memory count"
    )
    parser.add_argument(
        "--list-tags", action="store_true", help="List all unique tags"
    )
    args = parser.parse_args()

    collection = _common.get_collection()

    # --- Count mode ---
    if args.count:
        total = collection.count()
        print(f"Total memories: {total}")
        return

    # --- List tags mode ---
    if args.list_tags:
        total = collection.count()
        if total == 0:
            print("No memories stored.")
            return
        batch_size = 1000
        tag_counts: dict[str, int] = {}
        for offset in range(0, total, batch_size):
            batch = collection.get(
                include=["metadatas"], limit=batch_size, offset=offset
            )
            for meta in batch.get("metadatas", []):
                tags_csv = meta.get("tags", "")
                if tags_csv:
                    for tag in tags_csv.split(","):
                        tag = tag.strip()
                        if tag:
                            tag_counts[tag] = tag_counts.get(tag, 0) + 1

        if not tag_counts:
            print("No tags found.")
            return
        print(f"Tags ({len(tag_counts)} unique, {total} total memories):\n")
        for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1]):
            print(f"  {tag}: {count}")
        return

    # --- Query mode ---
    if not args.query:
        parser.error("--query is required unless --count or --list-tags is used")

    where = None
    if args.tags:
        tags = [t.strip() for t in args.tags.split(",") if t.strip()]
        where = _common.build_tag_filter(tags)

    results = collection.query(
        query_texts=[args.query],
        n_results=args.n_results,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    if args.json_output:
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return

    # Human-readable output
    if not results.get("ids") or not results["ids"][0]:
        print("No results found.")
        return

    ids = results["ids"][0]
    documents = results["documents"][0]
    metadatas = results["metadatas"][0]
    distances = results["distances"][0]

    print(f"Results ({len(ids)} found):\n")
    for rank, (doc_id, doc, meta, dist) in enumerate(
        zip(ids, documents, metadatas, distances), 1
    ):
        score = 1.0 - dist  # cosine distance → similarity

        if score >= 0.85:
            label = "★★★ 非常に高い一致"
        elif score >= 0.60:
            label = "★★  関連性が高い"
        elif score >= 0.35:
            label = "★   部分的に関連"
        else:
            label = "    関連性が低い"

        tags_csv = meta.get("tags", "")
        source = meta.get("source", "")
        created_at = meta.get("created_at", "")

        print(f"[{rank}] score={score:.4f}  {label}")
        print(f"     ID : {doc_id}")
        if tags_csv:
            print(f"     tags: {tags_csv}")
        if source:
            print(f"     src : {source}")
        if created_at:
            print(f"     at  : {created_at[:19]}")
        preview = doc[:200] + "..." if len(doc) > 200 else doc
        print(f"     {preview}")
        print()


if __name__ == "__main__":
    main()