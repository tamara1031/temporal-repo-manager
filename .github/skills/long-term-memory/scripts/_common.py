#!/usr/bin/env python3
"""Shared utilities: Docker lifecycle management + ChromaDB client.

chromadb Python パッケージ (HttpClient) を利用し、
エンベディングはクライアント側で計算、データは Docker コンテナに永続化。
"""

import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
CONTAINER_NAME = "copilot-memory-chromadb"
CHROMA_HOST = "localhost"
CHROMA_PORT = 18000
CHROMA_BASE_URL = f"http://{CHROMA_HOST}:{CHROMA_PORT}"
VOLUME_PATH = os.path.expanduser("~/.local/share/copilot-memory/chroma-data")
COLLECTION_NAME = "long_term_memory"
COMPOSE_FILE = str(Path(__file__).resolve().parent.parent / "docker" / "docker-compose.yml")
STARTUP_TIMEOUT = 60

# -----------------------------------------------------------------------------
# Package bootstrap
# -----------------------------------------------------------------------------

def _ensure_chromadb_package():
    """Import chromadb, installing it first if necessary."""
    try:
        import chromadb  # noqa: F811
        return chromadb
    except ImportError:
        print("Installing chromadb package...", file=sys.stderr)
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "chromadb>=0.5.0,<1.0.0"],
            stdout=subprocess.DEVNULL,
        )
        import chromadb  # noqa: F811
        return chromadb

# -----------------------------------------------------------------------------
# Docker lifecycle
# -----------------------------------------------------------------------------

def _docker_available() -> bool:
    try:
        subprocess.run(["docker", "info"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False

def _container_running() -> bool:
    result = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER_NAME],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"

def _wait_for_ready(timeout: int = STARTUP_TIMEOUT) -> None:
    deadline = time.time() + timeout
    endpoints = [
        f"{CHROMA_BASE_URL}/api/v2/heartbeat",
        f"{CHROMA_BASE_URL}/api/v1/heartbeat",
    ]
    while time.time() < deadline:
        for url in endpoints:
            try:
                req = urllib.request.urlopen(url, timeout=2)
                if req.status == 200:
                    return
            except Exception:
                pass
        time.sleep(1)
    raise TimeoutError(f"ChromaDB did not become ready within {timeout}s")

def ensure_chromadb() -> None:
    """Ensure ChromaDB Docker container is running and healthy."""
    if not _docker_available():
        print(
            "ERROR: Docker is not available. Please install and start Docker.",
            file=sys.stderr,
        )
        sys.exit(1)

    if _container_running():
        return

    os.makedirs(VOLUME_PATH, exist_ok=True)

    # Try docker compose v2 first, then fall back to v1
    for cmd_prefix in [["docker", "compose"], ["docker-compose"]]:
        result = subprocess.run(
            [*cmd_prefix, "-f", COMPOSE_FILE, "up", "-d"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            break
    else:
        print(
            f"ERROR: Failed to start ChromaDB container.\n{result.stderr}",
            file=sys.stderr,
        )
        sys.exit(1)

    print("Starting ChromaDB container...", file=sys.stderr)
    _wait_for_ready()
    print("ChromaDB is ready.", file=sys.stderr)

# -----------------------------------------------------------------------------
# ChromaDB client
# -----------------------------------------------------------------------------

_client = None
_collection = None

def get_collection():
    """Return the ChromaDB Collection object (lazy-initialized).
    
    Handles Docker startup, package install, and collection creation.
    """
    global _client, _collection
    if _collection is not None:
        return _collection

    ensure_chromadb()
    chromadb = _ensure_chromadb_package()

    _client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    _collection = _client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )
    return _collection

# -----------------------------------------------------------------------------
# Tag helpers
# -----------------------------------------------------------------------------

def build_tag_metadata(tags: list[str]) -> dict:
    """Build metadata entries for tag storage and filtering.
    
    Stores both a human-readable `tags` CSV field and individual
    `tag__<name>` fields for ChromaDB `where` filtering.
    """
    meta: dict = {}
    if tags:
        clean = [t.strip() for t in tags if t.strip()]
        meta["tags"] = ",".join(clean)
        for tag in clean:
            meta[f"tag__{tag.replace(' ', '_')}"] = "1"
    return meta

def build_tag_filter(tags: list[str]) -> dict | None:
    """Build a ChromaDB `where` clause for tag-based filtering."""
    clean = [t.strip() for t in tags if t.strip()]
    if not clean:
        return None
    conditions = [{f"tag__{t.replace(' ', '_')}": "1"} for t in clean]
    if len(conditions) == 1:
        return conditions[0]
    return {"$or": conditions}