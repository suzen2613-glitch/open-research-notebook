from __future__ import annotations

import re
from typing import Any, Optional

from open_notebook.database.repository import repo_query
from open_notebook.domain.notebook import Source
from open_notebook.services.source_dedupe import (
    get_effective_source_title,
    normalize_paper_title,
)

_REFERENCE_SECTION_RE = re.compile(
    r"^\s*(?:#{1,6}\s*)?(references|bibliography)\s*$",
    re.IGNORECASE,
)
_MARKDOWN_HEADING_RE = re.compile(r"^\s*(#{1,6})\s+")
_REFERENCE_ENTRY_START_RE = re.compile(r"^\s*(?:\[\d+\]|\d+[.)]|[-*])\s+")
_WHITESPACE_RE = re.compile(r"\s+")
_QUOTED_TITLE_RE = re.compile(r'[“"](.*?)[”"]')
_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[a-z0-9])\.\s+(?=[A-Z0-9])")
_DENSE_REFERENCE_BOUNDARY_RE = re.compile(
    r"(?<=\.)\s+(?=[A-Z][A-Za-z'’`-]+,\s(?:[A-Z]\.|[A-Z][a-z]))"
)


def _normalize_reference_text(value: str) -> str:
    cleaned = value.replace("**", " ").replace("__", " ").replace("`", " ")
    cleaned = cleaned.replace("*", " ")
    return _WHITESPACE_RE.sub(" ", cleaned).strip(" -.;,")


def _split_dense_reference_block(value: str) -> list[str]:
    cleaned = _normalize_reference_text(value)
    if not cleaned:
        return []

    looks_dense = len(cleaned) > 500 or cleaned.count(" et al.") >= 3 or cleaned.count(" arXiv preprint ") >= 2
    if not looks_dense:
        return [cleaned]

    parts = [_normalize_reference_text(part) for part in _DENSE_REFERENCE_BOUNDARY_RE.split(cleaned)]
    return [part for part in parts if part]


def extract_reference_entries(markdown_text: str | None) -> list[str]:
    if not markdown_text:
        return []

    lines = markdown_text.splitlines()
    start_index: Optional[int] = None
    base_heading_level: Optional[int] = None

    for index, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            continue
        if not _REFERENCE_SECTION_RE.match(line):
            continue
        heading_match = _MARKDOWN_HEADING_RE.match(raw_line)
        if heading_match:
            base_heading_level = len(heading_match.group(1))
        start_index = index + 1
        break

    if start_index is None:
        return []

    entries: list[str] = []
    current_lines: list[str] = []

    def flush_current() -> None:
        if not current_lines:
            return
        joined = " ".join(current_lines)
        for item in _split_dense_reference_block(joined):
            entries.append(item)
        current_lines.clear()

    for raw_line in lines[start_index:]:
        stripped = raw_line.strip()

        heading_match = _MARKDOWN_HEADING_RE.match(raw_line)
        if heading_match and base_heading_level is not None:
            heading_level = len(heading_match.group(1))
            if entries and heading_level <= base_heading_level:
                break

        if not stripped:
            flush_current()
            continue

        entry_start_match = _REFERENCE_ENTRY_START_RE.match(stripped)
        if entry_start_match:
            flush_current()
            current_lines.append(stripped[entry_start_match.end() :].strip())
            continue

        if current_lines:
            current_lines.append(stripped)
            continue

        if _YEAR_RE.search(stripped):
            current_lines.append(stripped)

    flush_current()
    return entries[:200]


def extract_reference_title(reference_text: str) -> str | None:
    candidate = _normalize_reference_text(reference_text)
    if not candidate:
        return None

    quoted = _QUOTED_TITLE_RE.search(candidate)
    if quoted:
        title = _normalize_reference_text(quoted.group(1))
        normalized_title = normalize_paper_title(title)
        if normalized_title and len(normalized_title.split()) >= 3:
            return title

    fragments = [fragment.strip(" ,;:-") for fragment in _SENTENCE_SPLIT_RE.split(candidate)]
    best_fragment: str | None = None
    best_score = -999

    for fragment in fragments:
        normalized = normalize_paper_title(fragment)
        if not normalized:
            continue

        words = normalized.split()
        if len(words) < 3 or len(words) > 28:
            continue
        if _YEAR_RE.fullmatch(fragment):
            continue

        score = 0
        if 5 <= len(words) <= 18:
            score += 3
        if ":" in fragment or "-" in fragment:
            score += 1
        if any(keyword in normalized for keyword in ("proceedings", "journal", "conference", "arxiv", "vol", "pp")):
            score -= 3
        if fragment.count(",") > 4:
            score -= 2

        if score > best_score:
            best_fragment = fragment
            best_score = score

    if not best_fragment:
        return None

    return _normalize_reference_text(best_fragment)


def _serialize_reference_match(
    row: dict[str, Any],
    *,
    raw_reference: Optional[str] = None,
) -> dict[str, Any]:
    return {
        "source_id": str(row.get("id") or ""),
        "source_title": get_effective_source_title(row) or row.get("title"),
        "raw_reference": raw_reference,
        "confidence": 1.0,
        "notebook_ids": [str(item) for item in (row.get("notebook_ids") or []) if item],
    }


async def build_source_reference_connections(
    source_id: str,
    *,
    notebook_id: str | None = None,
) -> dict[str, Any]:
    source = await Source.get(source_id)
    if not source:
        raise ValueError("Source not found")

    asset = getattr(source, "asset", None)
    source_row = {
        "id": source.id,
        "title": source.title,
        "full_text": source.full_text,
        "asset": asset.model_dump() if asset else None,
    }
    source_title = get_effective_source_title(source_row)
    source_normalized = normalize_paper_title(source_title)

    notebook_ids = [notebook_id] if notebook_id else await source.get_notebook_ids()
    notebook_scope = {str(item) for item in notebook_ids if item}

    if not notebook_scope:
        return {
            "source_id": source_id,
            "source_title": source_title,
            "notebook_scope_ids": [],
            "references_extracted": 0,
            "citations_in_notebook": [],
            "cited_by_in_notebook": [],
            "reference_candidates": [],
        }

    rows = await repo_query(
        """
        SELECT
            id,
            title,
            full_text,
            asset,
            array::distinct((SELECT VALUE out FROM reference WHERE in = id)) AS notebook_ids
        FROM source
        """
    )

    scope_rows = [
        row
        for row in rows
        if notebook_scope.intersection({str(item) for item in (row.get("notebook_ids") or []) if item})
    ]

    title_lookup: dict[str, dict[str, Any]] = {}
    for row in scope_rows:
        row_source_id = str(row.get("id") or "")
        if not row_source_id or row_source_id == source_id:
            continue
        normalized = normalize_paper_title(get_effective_source_title(row))
        if normalized and normalized not in title_lookup:
            title_lookup[normalized] = row

    citations_in_notebook: list[dict[str, Any]] = []
    reference_candidates: list[dict[str, Any]] = []
    seen_source_ids: set[str] = set()
    seen_candidates: set[str] = set()

    reference_entries = extract_reference_entries(source.full_text)
    for entry in reference_entries:
        title = extract_reference_title(entry)
        normalized = normalize_paper_title(title)
        if not normalized:
            continue

        matched_row = title_lookup.get(normalized)
        if matched_row:
            matched_source_id = str(matched_row.get("id") or "")
            if matched_source_id and matched_source_id not in seen_source_ids:
                seen_source_ids.add(matched_source_id)
                citations_in_notebook.append(
                    _serialize_reference_match(matched_row, raw_reference=entry)
                )
            continue

        if normalized in seen_candidates:
            continue
        seen_candidates.add(normalized)
        reference_candidates.append(
            {
                "title": title,
                "normalized_title": normalized,
                "raw_reference": entry,
            }
        )

    cited_by_in_notebook: list[dict[str, Any]] = []
    seen_cited_by: set[str] = set()
    if source_normalized:
        for row in scope_rows:
            row_source_id = str(row.get("id") or "")
            if not row_source_id or row_source_id == source_id:
                continue
            for entry in extract_reference_entries(row.get("full_text")):
                normalized = normalize_paper_title(extract_reference_title(entry))
                if normalized != source_normalized:
                    continue
                if row_source_id in seen_cited_by:
                    break
                seen_cited_by.add(row_source_id)
                cited_by_in_notebook.append(
                    _serialize_reference_match(row, raw_reference=entry)
                )
                break

    return {
        "source_id": source_id,
        "source_title": source_title,
        "notebook_scope_ids": sorted(notebook_scope),
        "references_extracted": len(reference_entries),
        "citations_in_notebook": citations_in_notebook,
        "cited_by_in_notebook": cited_by_in_notebook,
        "reference_candidates": reference_candidates[:20],
    }
