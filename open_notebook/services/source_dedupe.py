from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Source

_CONTROL_LINE_PATTERNS = (
    re.compile(r"^\s*-\s+zotero\s+", re.IGNORECASE),
    re.compile(r"^\s*<!--\s*zotero:", re.IGNORECASE),
    re.compile(r"^\s*-\s+authors?:\s+", re.IGNORECASE),
    re.compile(r"^\s*-\s+year:\s+", re.IGNORECASE),
    re.compile(r"^\s*-\s+doi:\s+", re.IGNORECASE),
    re.compile(r"^\s*-\s+arxiv:\s+", re.IGNORECASE),
    re.compile(r"^\s*-\s+venue:\s+", re.IGNORECASE),
)
_SECTION_HEADING_RE = re.compile(
    r"^(abstract|introduction|contents|index terms|keywords|references|acknowledg(e)?ments?)$",
    re.IGNORECASE,
)
_AUTHOR_LINE_RE = re.compile(r"^[A-Z][A-Za-z.\-']+(?:\s+[A-Z][A-Za-z.\-']+){0,4}(?:,\s*[A-Z][A-Za-z.\-']+(?:\s+[A-Z][A-Za-z.\-']+){0,4})*$")
_TITLE_WORD_RE = re.compile(r"[A-Za-z0-9]")
_FILE_EXTENSION_RE = re.compile(r"\.(md|markdown|pdf|txt|html?)$", re.IGNORECASE)
_TRAILING_COPY_RE = re.compile(r"\s*\((\d+)\)\s*$")
_EXPORT_PREFIX_RE = re.compile(
    r"^[^-]{1,80}\s*-\s*\d{4}\s*-\s*[^-]{1,120}\s*-\s*(.+)$",
    re.IGNORECASE,
)
_NON_TITLE_PREFIX_RE = re.compile(
    r"^(\*?(available online at|accepted manuscript|preprint submitted to|this article appeared in|keywords|index terms|manuscript received)\*?\s*[:—-]?)\b",
    re.IGNORECASE,
)
_AFFILIATION_LINE_RE = re.compile(
    r"\b(is with the|e-?mail\s*:|email\s*:|corresponding author)\b",
    re.IGNORECASE,
)
_VENUE_HEADER_KEYWORDS = (
    "journal",
    "transactions",
    "proceedings",
    "conference",
    "letters",
    "magazine",
    "review",
)


@dataclass
class DuplicateSourceCandidate:
    source_id: str
    title: str | None
    normalized_title: str
    notebook_ids: list[str]
    exclusive_to_notebook: bool


def normalize_paper_title(title: str | None) -> str:
    if not title:
        return ""

    normalized = unicodedata.normalize("NFKC", title).strip().casefold()
    normalized = normalized.replace("\u2010", "-").replace("\u2013", "-").replace("\u2014", "-")
    normalized = normalized.replace("&", " and ")
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def cleanup_filename_title(title: str | None) -> str | None:
    if not title:
        return None

    candidate = Path(str(title).strip()).name
    candidate = candidate.replace("+", " ").replace("_", " ")
    candidate = _FILE_EXTENSION_RE.sub("", candidate)
    candidate = _TRAILING_COPY_RE.sub("", candidate).strip()

    export_match = _EXPORT_PREFIX_RE.match(candidate)
    if export_match:
        candidate = export_match.group(1).strip()

    candidate = re.sub(r"\s+", " ", candidate).strip(" -_")
    if not candidate:
        return None

    normalized = normalize_paper_title(candidate)
    if not normalized or normalized == "untitled source":
        return None
    return candidate


def _is_probable_title_line(line: str) -> bool:
    stripped = line.strip().strip('"').strip("'").strip("*").strip("`")
    if not stripped:
        return False
    if len(stripped) < 12 or len(stripped) > 300:
        return False
    if _SECTION_HEADING_RE.match(stripped):
        return False
    if _NON_TITLE_PREFIX_RE.match(stripped):
        return False
    if _AFFILIATION_LINE_RE.search(stripped):
        return False
    if any(pattern.match(stripped) for pattern in _CONTROL_LINE_PATTERNS):
        return False
    if stripped.startswith("!"):
        return False
    if stripped.startswith("[") and stripped.endswith("]"):
        return False
    if _AUTHOR_LINE_RE.match(stripped):
        return False
    if stripped.count(" ") < 2:
        return False
    normalized = normalize_paper_title(stripped)
    if not normalized:
        return False
    words = normalized.split()
    if (
        len(words) <= 6
        and any(keyword in normalized for keyword in _VENUE_HEADER_KEYWORDS)
        and ":" not in stripped
        and "?" not in stripped
    ):
        return False
    return bool(_TITLE_WORD_RE.search(stripped))


def _score_title_candidate(candidate: str) -> int:
    normalized = normalize_paper_title(candidate)
    if not normalized:
        return -999

    words = normalized.split()
    score = 0
    if 6 <= len(words) <= 24:
        score += 4
    elif 4 <= len(words) <= 30:
        score += 2
    if ":" in candidate or "?" in candidate:
        score += 2
    if "-" in candidate:
        score += 1
    if _NON_TITLE_PREFIX_RE.match(candidate):
        score -= 10
    if len(words) <= 6 and any(keyword in normalized for keyword in _VENUE_HEADER_KEYWORDS):
        score -= 8
    return score


def extract_paper_title_from_markdown(markdown_text: str | None) -> str | None:
    if not markdown_text:
        return None

    lines = [line.strip() for line in markdown_text.splitlines()]
    lines = [line for line in lines if line]
    if not lines:
        return None

    heading_candidates: list[str] = []
    plain_candidates: list[str] = []
    for line in lines[:40]:
        if any(pattern.match(line) for pattern in _CONTROL_LINE_PATTERNS):
            continue

        heading = re.match(r"^#{1,2}\s+(.*)$", line)
        if heading:
            candidate = heading.group(1).strip()
            if _is_probable_title_line(candidate):
                heading_candidates.append(candidate)
            continue

        if _is_probable_title_line(line):
            plain_candidates.append(line)

    candidates = heading_candidates if heading_candidates else plain_candidates
    ranked_candidates = sorted(
        enumerate(candidates),
        key=lambda item: (_score_title_candidate(item[1]), -item[0]),
        reverse=True,
    )
    for _, candidate in ranked_candidates:
        normalized = normalize_paper_title(candidate)
        if normalized and normalized != "untitled source":
            return candidate.strip()
    return None


def get_effective_source_title(source_like: dict[str, Any]) -> str | None:
    extracted_title = extract_paper_title_from_markdown(source_like.get("full_text"))
    if extracted_title:
        return extracted_title

    for raw_title in (
        source_like.get("title"),
        (source_like.get("asset") or {}).get("file_path")
        if isinstance(source_like.get("asset"), dict)
        else None,
    ):
        cleaned_title = cleanup_filename_title(raw_title)
        if cleaned_title:
            return cleaned_title

    fallback_title = source_like.get("title")
    if not fallback_title:
        return None
    return str(fallback_title).strip() or None


async def find_source_by_normalized_title(
    normalized_title: str,
    *,
    notebook_id: str | None = None,
    exclude_source_id: str | None = None,
) -> DuplicateSourceCandidate | None:
    if not normalized_title:
        return None

    query = """
        SELECT
            id,
            title,
            full_text,
            asset,
            array::distinct((SELECT VALUE out FROM reference WHERE in = id)) AS notebook_ids
        FROM source
    """
    result = await repo_query(query)
    for row in result:
        source_id = str(row.get("id") or "")
        if not source_id or (exclude_source_id and source_id == exclude_source_id):
            continue

        candidate_normalized = normalize_paper_title(get_effective_source_title(row))
        if candidate_normalized != normalized_title:
            continue

        notebook_ids = [str(item) for item in (row.get("notebook_ids") or []) if item]
        if notebook_id and notebook_ids and notebook_id not in notebook_ids:
            continue

        exclusive_to_notebook = bool(
            notebook_id and notebook_ids and len(notebook_ids) == 1 and notebook_ids[0] == notebook_id
        )
        return DuplicateSourceCandidate(
            source_id=source_id,
            title=get_effective_source_title(row),
            normalized_title=candidate_normalized,
            notebook_ids=notebook_ids,
            exclusive_to_notebook=exclusive_to_notebook,
        )
    return None


async def analyze_notebook_duplicates(notebook_id: str) -> list[dict[str, Any]]:
    rows = await repo_query(
        """
        SELECT id, title, full_text, asset, created, updated
        FROM (
            SELECT VALUE in FROM reference WHERE out = $notebook_id
        )
        ORDER BY updated DESC
        """,
        {"notebook_id": ensure_record_id(notebook_id)},
    )
    buckets: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        effective_title = get_effective_source_title(row)
        normalized = normalize_paper_title(effective_title)
        if not normalized:
            continue
        row = {**row, "effective_title": effective_title}
        buckets.setdefault(normalized, []).append(row)

    duplicates: list[dict[str, Any]] = []
    for normalized_title, entries in buckets.items():
        if len(entries) < 2:
            continue
        ordered = sorted(
            entries,
            key=lambda item: (
                str(item.get("updated") or ""),
                str(item.get("created") or ""),
                str(item.get("id") or ""),
            ),
            reverse=True,
        )
        keep = ordered[0]
        remove = ordered[1:]
        duplicates.append(
            {
                "normalized_title": normalized_title,
                "keep_source_id": str(keep["id"]),
                "keep_title": keep.get("effective_title") or keep.get("title"),
                "duplicate_count": len(remove),
                "duplicates": [
                    {
                        "source_id": str(item["id"]),
                        "title": item.get("effective_title") or item.get("title"),
                        "created": str(item.get("created") or ""),
                        "updated": str(item.get("updated") or ""),
                    }
                    for item in remove
                ],
            }
        )

    duplicates.sort(key=lambda item: item["duplicate_count"], reverse=True)
    return duplicates


async def cleanup_notebook_duplicates(notebook_id: str) -> dict[str, Any]:
    duplicate_groups = await analyze_notebook_duplicates(notebook_id)
    removed_source_ids: list[str] = []
    unlinked_source_ids: list[str] = []

    for group in duplicate_groups:
        for duplicate in group["duplicates"]:
            source_id = duplicate["source_id"]
            source = await Source.get(source_id)
            notebook_ids = await source.get_notebook_ids()
            if len(notebook_ids) <= 1:
                await source.delete()
                removed_source_ids.append(source_id)
                continue

            await repo_query(
                "DELETE reference WHERE out = $source_id AND in = $notebook_id",
                {
                    "source_id": ensure_record_id(source_id),
                    "notebook_id": ensure_record_id(notebook_id),
                },
            )
            unlinked_source_ids.append(source_id)

    return {
        "groups": duplicate_groups,
        "removed_source_ids": removed_source_ids,
        "unlinked_source_ids": unlinked_source_ids,
        "removed_count": len(removed_source_ids),
        "unlinked_count": len(unlinked_source_ids),
    }
