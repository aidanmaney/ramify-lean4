#!/usr/bin/env python3
"""
Find Lean 4 proofs on GitHub using the GitHub Search API.

Usage:
    python find_lean4_proofs.py [OPTIONS]

Requires a GitHub personal access token set as GITHUB_TOKEN environment variable.
(Without a token, you're limited to 10 requests/minute; with one, 30/minute.)
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from dataclasses import dataclass, field
from typing import Optional


GITHUB_API = "https://api.github.com"
SEARCH_CODE_URL = f"{GITHUB_API}/search/code"
SEARCH_REPOS_URL = f"{GITHUB_API}/search/repositories"


@dataclass
class SearchResult:
    name: str
    path: str
    repo: str
    url: str
    html_url: str
    score: float
    snippet: Optional[str] = None


@dataclass
class RepoResult:
    full_name: str
    description: str
    url: str
    stars: int
    language: Optional[str]
    topics: list[str] = field(default_factory=list)


def github_request(url: str, token: Optional[str] = None) -> dict:
    """Make an authenticated request to the GitHub API with rate-limit handling."""
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "lean4-proof-finder",
    }
    # Required for code search to use the newer engine
    headers["Accept"] = "application/vnd.github.text-match+json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            remaining = resp.headers.get("X-RateLimit-Remaining", "?")
            reset_time = resp.headers.get("X-RateLimit-Reset")
            if remaining != "?" and int(remaining) < 3 and reset_time:
                wait = max(0, int(reset_time) - int(time.time())) + 1
                print(
                    f"  ⏳ Rate limit almost exhausted. Waiting {wait}s...",
                    file=sys.stderr,
                )
                time.sleep(wait)
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 403:
            reset_time = e.headers.get("X-RateLimit-Reset")
            if reset_time:
                wait = max(0, int(reset_time) - int(time.time())) + 1
                print(f"  ⏳ Rate limited. Waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)
                return github_request(url, token)
        body = e.read().decode() if e.fp else ""
        print(f"HTTP {e.code}: {body}", file=sys.stderr)
        raise
    except urllib.error.URLError as e:
        print(f"Network error: {e.reason}", file=sys.stderr)
        raise


def search_code(
    query: str,
    token: Optional[str] = None,
    per_page: int = 30,
    page: int = 1,
    sort: str = "indexed",
) -> tuple[int, list[SearchResult]]:
    """Search GitHub code for Lean 4 files matching a query."""
    params = urllib.parse.urlencode(
        {
            "q": query,
            "per_page": per_page,
            "page": page,
            "sort": sort,
        }
    )
    url = f"{SEARCH_CODE_URL}?{params}"
    data = github_request(url, token)

    total = data.get("total_count", 0)
    results = []
    for item in data.get("items", []):
        # Extract text match snippets if available
        snippet = None
        text_matches = item.get("text_matches", [])
        if text_matches:
            fragments = []
            for tm in text_matches[:3]:
                fragments.append(tm.get("fragment", ""))
            snippet = "\n---\n".join(fragments)

        results.append(
            SearchResult(
                name=item["name"],
                path=item["path"],
                repo=item["repository"]["full_name"],
                url=item["url"],
                html_url=item["html_url"],
                score=item.get("score", 0),
                snippet=snippet,
            )
        )
    return total, results


def search_repos(
    query: str,
    token: Optional[str] = None,
    per_page: int = 20,
    sort: str = "stars",
) -> tuple[int, list[RepoResult]]:
    """Search for repositories related to Lean 4 proofs."""
    params = urllib.parse.urlencode(
        {
            "q": query,
            "per_page": per_page,
            "sort": sort,
            "order": "desc",
        }
    )
    url = f"{SEARCH_REPOS_URL}?{params}"
    data = github_request(url, token)

    total = data.get("total_count", 0)
    results = []
    for item in data.get("items", []):
        results.append(
            RepoResult(
                full_name=item["full_name"],
                description=item.get("description") or "",
                url=item["html_url"],
                stars=item.get("stargazers_count", 0),
                language=item.get("language"),
                topics=item.get("topics", []),
            )
        )
    return total, results


# ---------------------------------------------------------------------------
# Pre-built search queries targeting common Lean 4 proof patterns
# ---------------------------------------------------------------------------

PROOF_QUERIES = {
    "theorem": 'language:Lean "theorem" "Proof" extension:lean',
    "tactic": 'language:Lean "by" "simp" "rfl" extension:lean',
    "induction": 'language:Lean "induction" "case" extension:lean',
    "mathlib": 'language:Lean "import Mathlib" extension:lean',
    "calc": 'language:Lean "calc" "_ =" extension:lean',
    "have-show": 'language:Lean "have" "show" "exact" extension:lean',
    "sorry-free": 'language:Lean "theorem" NOT "sorry" extension:lean',
    "omega": 'language:Lean "omega" "theorem" extension:lean',
    "category-theory": 'language:Lean "Category" "Functor" extension:lean',
    "custom": None,  # user-supplied
}

REPO_QUERIES = {
    "lean4-projects": "lean4 proof language:Lean",
    "mathlib4": "mathlib4 lean",
    "formalization": "formalization lean 4",
    "theorem-proving": "theorem proving lean4",
}


def display_code_results(
    total: int, results: list[SearchResult], verbose: bool = False
):
    print(f"\n{'=' * 70}")
    print(f"  Found {total} matching files (showing {len(results)})")
    print(f"{'=' * 70}\n")
    for i, r in enumerate(results, 1):
        print(f"  [{i}] {r.repo}")
        print(f"      📄 {r.path}")
        print(f"      🔗 {r.html_url}")
        if verbose and r.snippet:
            print(f"      ── snippet ──")
            for line in r.snippet.splitlines():
                print(f"      │ {line}")
            print(f"      ────────────")
        print()


def display_repo_results(total: int, results: list[RepoResult]):
    print(f"\n{'=' * 70}")
    print(f"  Found {total} repositories (showing {len(results)})")
    print(f"{'=' * 70}\n")
    for i, r in enumerate(results, 1):
        stars = f"⭐ {r.stars}" if r.stars else ""
        print(f"  [{i}] {r.full_name}  {stars}")
        if r.description:
            print(f"      {r.description[:100]}")
        print(f"      🔗 {r.url}")
        if r.topics:
            print(f"      🏷  {', '.join(r.topics[:8])}")
        print()


def interactive_mode(token: Optional[str]):
    """Run an interactive search session."""
    print("\n╔══════════════════════════════════════════╗")
    print("║     Lean 4 Proof Finder — GitHub Search  ║")
    print("╚══════════════════════════════════════════╝\n")

    print("Available preset searches:")
    for i, (key, desc) in enumerate(PROOF_QUERIES.items(), 1):
        label = (
            desc[:60] + "..." if desc and len(desc) > 60 else (desc or "your own query")
        )
        print(f"  {i:2}. [{key}] {label}")

    print(f"\nRepository presets:")
    for i, (key, q) in enumerate(REPO_QUERIES.items(), 1):
        print(f"  r{i}. [{key}] {q}")

    print("\nCommands: <number> | r<number> | q:<raw query> | repos:<query> | quit\n")

    proof_keys = list(PROOF_QUERIES.keys())
    repo_keys = list(REPO_QUERIES.keys())

    while True:
        try:
            choice = input("search> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye!")
            break

        if not choice or choice in ("quit", "exit", "q"):
            print("Bye!")
            break

        # Raw code query
        if choice.startswith("q:"):
            raw = choice[2:].strip()
            query = f"{raw} language:Lean extension:lean"
            print(f"  Searching code: {query}")
            total, results = search_code(query, token)
            display_code_results(total, results, verbose=True)
            continue

        # Raw repo query
        if choice.startswith("repos:"):
            raw = choice[6:].strip()
            print(f"  Searching repos: {raw}")
            total, results = search_repos(raw, token)
            display_repo_results(total, results)
            continue

        # Repo preset
        if choice.startswith("r") and choice[1:].isdigit():
            idx = int(choice[1:]) - 1
            if 0 <= idx < len(repo_keys):
                key = repo_keys[idx]
                query = REPO_QUERIES[key]
                print(f"  Searching repos: {query}")
                total, results = search_repos(query, token)
                display_repo_results(total, results)
            else:
                print("  Invalid repo preset number.")
            continue

        # Code preset
        if choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(proof_keys):
                key = proof_keys[idx]
                if key == "custom":
                    raw = input("  Enter search terms: ").strip()
                    if not raw:
                        continue
                    query = f"{raw} language:Lean extension:lean"
                else:
                    query = PROOF_QUERIES[key]
                print(f"  Searching code: {query}")
                total, results = search_code(query, token)
                display_code_results(total, results, verbose=True)
            else:
                print("  Invalid preset number.")
            continue

        # Default: treat as a code search
        query = f"{choice} language:Lean extension:lean"
        print(f"  Searching code: {query}")
        total, results = search_code(query, token)
        display_code_results(total, results, verbose=True)


def main():
    parser = argparse.ArgumentParser(
        description="Find Lean 4 proofs on GitHub",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --interactive
  %(prog)s --preset theorem
  %(prog)s --query '"Finset" "sum" "induction"'
  %(prog)s --repos --query "lean4 formalization"
  %(prog)s --preset mathlib --per-page 10 --verbose
        """,
    )
    parser.add_argument(
        "-i", "--interactive", action="store_true", help="Interactive mode"
    )
    parser.add_argument(
        "-p", "--preset", choices=list(PROOF_QUERIES.keys()), help="Use a preset search"
    )
    parser.add_argument(
        "-q",
        "--query",
        type=str,
        help="Custom search query (Lean language filter added automatically)",
    )
    parser.add_argument(
        "-r", "--repos", action="store_true", help="Search repositories instead of code"
    )
    parser.add_argument(
        "-n", "--per-page", type=int, default=20, help="Results per page (default: 20)"
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Show code snippets"
    )
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    parser.add_argument("--page", type=int, default=1, help="Result page number")

    args = parser.parse_args()
    token = os.environ.get("GITHUB_TOKEN")

    if not token:
        print(
            "⚠  GITHUB_TOKEN not set. Rate limits will be strict (10 req/min).",
            file=sys.stderr,
        )
        print("   Set it: export GITHUB_TOKEN=ghp_...\n", file=sys.stderr)

    if args.interactive:
        interactive_mode(token)
        return

    if not args.preset and not args.query:
        parser.print_help()
        print("\nTip: use --interactive for a guided experience.")
        return

    # Build query
    if args.repos:
        query = args.query or REPO_QUERIES.get(args.preset, "lean4 proof")
        total, results = search_repos(query, token, per_page=args.per_page)
        if args.json:
            print(json.dumps([r.__dict__ for r in results], indent=2))
        else:
            display_repo_results(total, results)
    else:
        if args.preset and args.preset != "custom":
            query = PROOF_QUERIES[args.preset]
        elif args.query:
            query = f"{args.query} language:Lean extension:lean"
        else:
            query = 'language:Lean "theorem" extension:lean'

        total, results = search_code(
            query, token, per_page=args.per_page, page=args.page
        )
        if args.json:
            print(json.dumps([r.__dict__ for r in results], indent=2))
        else:
            display_code_results(total, results, verbose=args.verbose)


if __name__ == "__main__":
    main()
