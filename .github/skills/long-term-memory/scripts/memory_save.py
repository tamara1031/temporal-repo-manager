#!/usr/bin/env python3
"""Save knowledge to long-term memory with automatic decomposition."""

import argparse
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _common

# -----------------------------------------------------------------------------
# Text decomposition
# -----------------------------------------------------------------------------

def decompose_text(text: str, max_chunk_size: int = 500) -> list[str]:
    """Decompose raw text into knowledge units.
    
    Strategy:
    1. Split by double newlines (paragraphs).
    2. If a paragraph is a pure list, split into individual items.
    3. If a paragraph exceeds *max_chunk_size*, split by sentences.
    """
    paragraphs = re.split(r"\n\s*\n", text.strip())
    units: list[str] = []

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        lines = para.split("\n")
        list_items = [
            ln
            for ln in lines
            if re.match(r"^\s*[-*•]\s+|^\s*\d+[.)]\s+", ln)
        ]

        if len(list_items) > 1 and len(list_items) == len(lines):
            # Pure list - each item becomes a knowledge unit
            for item in list_items:
                cleaned = re.sub(
                    r"^\s*[-*•]\s+|^\s*\d+[.)]\s+", "", item
                ).strip()
                if cleaned:
                    units.append(cleaned)
        elif len(para) > max_chunk_size:
            # Long paragraph - split by sentence boundaries
            sentences = re.split(r"(?<=[。．！？!?])\s*", para)
            current = ""
            for sent in sentences:
                if not sent.strip():
                    continue
                if current and len(current) + len(sent) > max_chunk_size:
                    units.append(current.strip())
                    current = sent
                else:
                    current = f"{current} {sent}" if current else sent
            if current.strip():
                units.append(current.strip())
        else:
            units.append(para)

    return units

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Save knowledge to long-term memory"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--items",
        type=str,
        help='JSON array of knowledge items: [{"text": "...", "tags": [...], "source": "..."}]',
    )
    group.add_argument(
        "--text",
        type=str,
        help="Raw text to auto-decompose into knowledge units",
    )
    group.add_argument(
        "--file",
        type=str,
        help="File path to read text from",
    )
    parser.add_argument(
        "--tags",
        type=str,
        help="Comma-separated tags (applied to all items)",
    )
    parser.add_argument(
        "--source",
        type=str,
        default="",
        help="Source identifier",
    )
    parser.add_argument(
        "--max-chunk-size",
        type=int,
        default=500,
        help="Max characters per knowledge unit for auto-decomposition",
    )
    parser.add_argument(
        "--dedup",
        action="store_true",
        help="Check for semantic duplicates before saving (skip items with similarity >= threshold)",
    )
    parser.add_argument(
        "--dedup-threshold",
        type=float,
        default=0.90,
        help="Similarity threshold for dedup (0.0-1.0, default: 0.90)",
    )
    args = parser.parse_args()

    # --- Collect knowledge items ---
    items: list[dict] = []
    global_tags = (
        [t.strip() for t in args.tags.split(",") if t.strip()] if args.tags else []
    )

    if args.items:
        raw_items = json.loads(args.items)
        for item in raw_items:
            if isinstance(item, str):
                items.append(
                    {"text": item, "tags": list(global_tags), "source": args.source}
                )
            elif isinstance(item, dict):
                item_tags = item.get("tags", [])
                if global_tags:
                    item_tags = list(set(item_tags + global_tags))
                items.append(
                    {
                        "text": item["text"],
                        "tags": item_tags,
                        "source": item.get("source", args.source),
                    }
                )
    elif args.text:
        for unit in decompose_text(args.text, args.max_chunk_size):
            items.append({"text": unit, "tags": list(global_tags), "source": args.source})
    elif args.file:
        file_path = Path(args.file).expanduser()
        text = file_path.read_text(encoding="utf-8")
        for unit in decompose_text(text, args.max_chunk_size):
            items.append({"text": unit, "tags": list(global_tags), "source": args.source})

    if not items:
        print("No knowledge items to save.", file=sys.stderr)
        sys.exit(1)

    # --- Ensure ChromaDB ---
    collection = _common.get_collection()

    # --- Dedup check ---
    skipped: list[dict] = []
    if args.dedup and collection.count() > 0:
        kept: list[dict] = []
        for item in items:
            results = collection.query(
                query_texts=[item["text"]],
                n_results=1,
                include=["documents", "distances"],
            )
            if (
                results["distances"]
                and results["distances"][0]
                and (1 - results["distances"][0][0]) >= args.dedup_threshold
            ):
                existing_doc = results["documents"][0][0] if results["documents"][0] else ""
                similarity = 1 - results["distances"][0][0]
                skipped.append({
                    "text": item["text"],
                    "similar_to": existing_doc,
                    "similarity": similarity,
                })
            else:
                kept.append(item)
        items = kept

    if not items and skipped:
        print(f"All {len(skipped)} item(s) skipped as duplicates:")
        for s in skipped:
            print(f" SKIP (sim={s['similarity']:.4f}): {s['text'][:80]}...")
            print(f"   ≈ {s['similar_to'][:80]}...")
        return

    if not items:
        print("No knowledge items to save.", file=sys.stderr)
        sys.exit(1)

    # --- Prepare documents ---
    now = datetime.now(timezone.utc).isoformat()
    ids: list[str] = []
    documents: list[str] = []
    metadatas: list[dict] = []

    for item in items:
        doc_id = str(uuid.uuid4())
        ids.append(doc_id)
        documents.append(item["text"])
        
        meta: dict = {
            "created_at": now,
            "updated_at": now,
            "source": item.get("source", ""),
        }
        meta.update(_common.build_tag_metadata(item.get("tags", [])))
        metadatas.append(meta)

    # --- Save ---
    collection.add(ids=ids, documents=documents, metadatas=metadatas)

    # --- Report ---
    print(f"Saved {len(ids)} knowledge unit(s):")
    for i, (doc_id, doc) in enumerate(zip(ids, documents), 1):
        preview = doc[:100] + "..." if len(doc) > 100 else doc
        print(f"  [{i}] {doc_id}: {preview}")

    if skipped:
        print(f"\nSkipped {len(skipped)} duplicate(s):")
        for s in skipped:
            print(f" SKIP (sim={s['similarity']:.4f}): {s['text'][:80]}...")

if __name__ == "__main__":
    main()