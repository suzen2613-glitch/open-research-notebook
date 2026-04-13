from __future__ import annotations

import asyncio
import os
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

from loguru import logger

from open_notebook.database.repository import ensure_record_id, repo_create, repo_query
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.services.source_ingest import (
    create_source_placeholder,
    queue_source_processing,
    resolve_transformation_ids,
    validate_notebook_ids,
)
from open_notebook.services.source_dedupe import (
    extract_paper_title_from_markdown,
    find_source_by_normalized_title,
    normalize_paper_title,
)
from open_notebook.utils.pdf_conversion import convert_pdf

DEFAULT_ZOTERO_DIR = Path.home() / "Zotero"
ZOTERO_DB_PATH = Path(os.getenv("ZOTERO_DB_PATH", str(DEFAULT_ZOTERO_DIR / "zotero.sqlite")))
ZOTERO_STORAGE_DIR = Path(os.getenv("ZOTERO_STORAGE_DIR", str(DEFAULT_ZOTERO_DIR / "storage")))
ITEM_PROGRESS_PHASES = ("checking_existing", "converting_pdf", "creating_source")


@dataclass
class ZoteroCollection:
    id: int
    key: str
    name: str
    parent_id: int | None
    library_id: int | None
    item_count: int
    pdf_count: int


@dataclass
class ZoteroPdfItem:
    item_id: int
    item_key: str
    title: str
    year: str | None
    authors: list[str]
    collection_id: int
    collection_name: str
    attachment_item_id: int
    attachment_key: str
    attachment_path: str

    @property
    def resolved_pdf_path(self) -> Path:
        raw = self.attachment_path or ""
        if raw.startswith("storage:"):
            rel_name = raw.split(":", 1)[1]
            return ZOTERO_STORAGE_DIR / self.attachment_key / rel_name
        if raw.startswith("attachments:"):
            rel_name = raw.split(":", 1)[1]
            return ZOTERO_STORAGE_DIR / self.attachment_key / rel_name
        p = Path(raw)
        return p if p.is_absolute() else (ZOTERO_STORAGE_DIR / raw)


class ZoteroImportError(RuntimeError):
    pass


class ZoteroImportCancelled(ZoteroImportError):
    def __init__(self, result: dict[str, Any]):
        super().__init__("Zotero import canceled")
        self.result = result


class ZoteroImporter:
    def __init__(self, db_path: Path = ZOTERO_DB_PATH):
        self.db_path = Path(db_path)
        if not self.db_path.exists():
            raise ZoteroImportError(f"Zotero database not found: {self.db_path}")

    def _connect(self) -> sqlite3.Connection:
        uri = f"file:{self.db_path.resolve()}?mode=ro&immutable=1"
        conn = sqlite3.connect(uri, uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def list_collections(self) -> list[ZoteroCollection]:
        with self._connect() as conn:
            cur = conn.cursor()
            rows = cur.execute(
                """
                SELECT
                  c.collectionID,
                  c.key,
                  c.collectionName,
                  c.parentCollectionID,
                  c.libraryID,
                  COUNT(DISTINCT ci.itemID) AS item_count,
                  COUNT(DISTINCT CASE WHEN ia.contentType = 'application/pdf' THEN ci.itemID END) AS pdf_count
                FROM collections c
                LEFT JOIN collectionItems ci ON ci.collectionID = c.collectionID
                LEFT JOIN itemAttachments ia ON ia.parentItemID = ci.itemID
                GROUP BY c.collectionID, c.key, c.collectionName, c.parentCollectionID, c.libraryID
                ORDER BY c.collectionName COLLATE NOCASE
                """
            ).fetchall()
        return [
            ZoteroCollection(
                id=row["collectionID"],
                key=row["key"],
                name=row["collectionName"],
                parent_id=row["parentCollectionID"],
                library_id=row["libraryID"],
                item_count=row["item_count"] or 0,
                pdf_count=row["pdf_count"] or 0,
            )
            for row in rows
        ]

    def get_collection_items(self, collection_id: int) -> list[ZoteroPdfItem]:
        with self._connect() as conn:
            cur = conn.cursor()
            rows = cur.execute(
                """
                SELECT
                  c.collectionID,
                  c.collectionName,
                  parent.itemID AS item_id,
                  parent.key AS item_key,
                  att.itemID AS attachment_item_id,
                  child.key AS attachment_key,
                  ia.path AS attachment_path,
                  MAX(CASE WHEN f.fieldName = 'title' THEN idv.value END) AS title,
                  MAX(CASE WHEN f.fieldName = 'date' THEN idv.value END) AS date
                FROM collections c
                JOIN collectionItems ci ON ci.collectionID = c.collectionID
                JOIN items parent ON parent.itemID = ci.itemID
                JOIN itemAttachments ia ON ia.parentItemID = parent.itemID AND ia.contentType = 'application/pdf'
                JOIN items child ON child.itemID = ia.itemID
                LEFT JOIN itemData id ON id.itemID = parent.itemID
                LEFT JOIN fieldsCombined f ON f.fieldID = id.fieldID
                LEFT JOIN itemDataValues idv ON idv.valueID = id.valueID
                LEFT JOIN itemAttachments att ON att.itemID = child.itemID
                WHERE c.collectionID = ?
                GROUP BY c.collectionID, c.collectionName, parent.itemID, parent.key, att.itemID, child.key, ia.path
                ORDER BY COALESCE(title, parent.key)
                """,
                (collection_id,),
            ).fetchall()

            items: list[ZoteroPdfItem] = []
            for row in rows:
                item_id = row["item_id"]
                authors = [
                    self._format_creator(r)
                    for r in cur.execute(
                        """
                        SELECT cd.firstName, cd.lastName, cd.fieldMode
                        FROM itemCreators ic
                        JOIN creators cd ON cd.creatorID = ic.creatorID
                        WHERE ic.itemID = ?
                        ORDER BY ic.orderIndex ASC
                        """,
                        (item_id,),
                    ).fetchall()
                ]
                authors = [a for a in authors if a]
                title = row["title"] or row["item_key"]
                date = row["date"] or ""
                year_match = re.search(r"(19|20)\d{2}", date)
                year = year_match.group(0) if year_match else None
                items.append(
                    ZoteroPdfItem(
                        item_id=item_id,
                        item_key=row["item_key"],
                        title=title,
                        year=year,
                        authors=authors,
                        collection_id=row["collectionID"],
                        collection_name=row["collectionName"],
                        attachment_item_id=row["attachment_item_id"],
                        attachment_key=row["attachment_key"],
                        attachment_path=row["attachment_path"],
                    )
                )
            return items

    @staticmethod
    def _format_creator(row: sqlite3.Row) -> str:
        first = (row["firstName"] or "").strip()
        last = (row["lastName"] or "").strip()
        if row["fieldMode"] == 1:
            return last or first
        return " ".join([p for p in [first, last] if p]).strip()


def _build_zotero_marker(item: ZoteroPdfItem) -> str:
    return (
        "<!-- zotero:"
        f"item_key={item.item_key};"
        f"attachment_key={item.attachment_key};"
        f"collection_id={item.collection_id}"
        " -->"
    )
async def _link_source_to_notebooks(source_id: str, notebook_ids: list[str]) -> int:
    if not notebook_ids:
        return 0

    linked = 0
    source_record_id = ensure_record_id(source_id)
    for notebook_id in notebook_ids:
        notebook_record_id = ensure_record_id(notebook_id)
        existing_ref = await repo_query(
            "SELECT id FROM reference WHERE in = $source_id AND out = $notebook_id LIMIT 1",
            {
                "source_id": source_record_id,
                "notebook_id": notebook_record_id,
            },
        )
        if existing_ref:
            continue

        await repo_query(
            "RELATE $source_id->reference->$notebook_id",
            {
                "source_id": source_record_id,
                "notebook_id": notebook_record_id,
            },
        )
        linked += 1

    return linked


async def _record_zotero_source(item: ZoteroPdfItem, source_id: str) -> None:
    existing = await repo_query(
        """
        SELECT id
        FROM zotero_source
        WHERE item_key = $item_key AND attachment_key = $attachment_key
        LIMIT 1
        """,
        {
            "item_key": item.item_key,
            "attachment_key": item.attachment_key,
        },
    )
    payload = {
        "source": ensure_record_id(source_id),
        "item_key": item.item_key,
        "attachment_key": item.attachment_key,
        "collection_id": item.collection_id,
        "collection_name": item.collection_name,
        "title": item.title,
    }

    if existing:
        await repo_query(
            "UPDATE $record_id MERGE $data",
            {
                "record_id": ensure_record_id(existing[0]["id"]),
                "data": payload,
            },
        )
        return

    await repo_create("zotero_source", payload)


async def _find_existing_zotero_source(item: ZoteroPdfItem) -> str | None:
    indexed = await repo_query(
        """
        SELECT source
        FROM zotero_source
        WHERE item_key = $item_key AND attachment_key = $attachment_key
        LIMIT 1
        """,
        {
            "item_key": item.item_key,
            "attachment_key": item.attachment_key,
        },
    )
    if indexed and indexed[0].get("source"):
        candidate_source_id = str(indexed[0]["source"])
        existing_source = await repo_query(
            "SELECT id FROM source WHERE id = $source_id LIMIT 1",
            {"source_id": ensure_record_id(candidate_source_id)},
        )
        if existing_source:
            return candidate_source_id

    marker = _build_zotero_marker(item)
    legacy_candidates = await repo_query(
        """
        SELECT id, full_text
        FROM source
        WHERE title = $title
        LIMIT 10
        """,
        {"title": item.title},
    )
    for candidate in legacy_candidates:
        full_text = candidate.get("full_text") or ""
        if marker not in full_text:
            continue

        source_id = str(candidate["id"])
        await _record_zotero_source(item, source_id)
        return source_id

    return None


async def _find_existing_source_by_actual_title(
    actual_title: str | None,
    notebook_ids: list[str],
    *,
    exclude_source_id: str | None = None,
) -> str | None:
    normalized_title = normalize_paper_title(actual_title)
    if not normalized_title:
        return None

    for notebook_id in notebook_ids:
        existing = await find_source_by_normalized_title(
            normalized_title,
            notebook_id=notebook_id,
            exclude_source_id=exclude_source_id,
        )
        if existing:
            return existing.source_id

    existing = await find_source_by_normalized_title(
        normalized_title,
        exclude_source_id=exclude_source_id,
    )
    if existing:
        return existing.source_id

    return None


async def import_zotero_collection(
    collection_id: int,
    notebook_ids: list[str],
    embed: bool = True,
    skip_existing: bool = True,
    progress_callback: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    should_cancel: Callable[[], Awaitable[bool]] | None = None,
) -> dict[str, Any]:
    importer = ZoteroImporter()
    items = importer.get_collection_items(collection_id)
    results: list[dict[str, Any]] = []
    imported = 0
    skipped = 0
    failed = 0
    collection_name = items[0].collection_name if items else None
    await validate_notebook_ids(notebook_ids)
    default_transformation_ids = await resolve_transformation_ids([])
    content_settings = await ContentSettings.get_instance()
    selected_pdf_engine = content_settings.default_pdf_processing_engine or "auto"

    def build_result(*, cancelled: bool = False) -> dict[str, Any]:
        return {
            "collection_id": collection_id,
            "collection_name": collection_name,
            "total": len(items),
            "imported": imported,
            "skipped": skipped,
            "failed": failed,
            "cancelled": cancelled,
            "results": results,
        }

    async def emit_progress(
        *,
        phase: str,
        current_item: str | None = None,
        current_index: int | None = None,
        item_phase: str | None = None,
        error_message: str | None = None,
        cancel_requested: bool = False,
    ) -> None:
        if not progress_callback:
            return

        processed = imported + skipped + failed
        percentage = (processed / len(items) * 100) if items else 100.0
        item_phase_index = (
            ITEM_PROGRESS_PHASES.index(item_phase) + 1
            if item_phase in ITEM_PROGRESS_PHASES
            else None
        )
        item_phase_percentage = (
            round(item_phase_index / len(ITEM_PROGRESS_PHASES) * 100, 1)
            if item_phase_index
            else None
        )

        await progress_callback(
            {
                "phase": phase,
                "collection_id": collection_id,
                "collection_name": collection_name,
                "total": len(items),
                "processed": processed,
                "imported": imported,
                "skipped": skipped,
                "failed": failed,
                "percentage": round(percentage, 1),
                "current_item": current_item,
                "current_index": current_index,
                "item_phase": item_phase,
                "item_phase_index": item_phase_index,
                "item_phase_total": len(ITEM_PROGRESS_PHASES) if item_phase else None,
                "item_phase_percentage": item_phase_percentage,
                "error_message": error_message,
                "cancel_requested": cancel_requested,
            }
        )

    async def ensure_not_canceled(
        *,
        current_item: str | None = None,
        current_index: int | None = None,
        item_phase: str | None = None,
    ) -> None:
        if not should_cancel:
            return
        if not await should_cancel():
            return

        await emit_progress(
            phase="canceled",
            current_item=current_item,
            current_index=current_index,
            item_phase=item_phase,
            cancel_requested=True,
        )
        raise ZoteroImportCancelled(build_result(cancelled=True))

    await emit_progress(phase="starting")

    for index, item in enumerate(items, start=1):
        title = item.title
        try:
            await ensure_not_canceled(
                current_item=title,
                current_index=index,
                item_phase="checking_existing",
            )
            await emit_progress(
                phase="processing",
                current_item=title,
                current_index=index,
                item_phase="checking_existing",
            )
            pdf_path = item.resolved_pdf_path
            if not pdf_path.exists():
                raise ZoteroImportError(f"Missing PDF: {pdf_path}")

            if skip_existing:
                existing_source_id = await _find_existing_zotero_source(item)
                if existing_source_id:
                    linked_notebooks = await _link_source_to_notebooks(
                        existing_source_id, notebook_ids
                    )
                    skipped += 1
                    results.append(
                        {
                            "title": title,
                            "status": "skipped",
                            "reason": "already_imported",
                            "source_id": existing_source_id,
                            "item_key": item.item_key,
                            "attachment_key": item.attachment_key,
                            "linked_notebooks": linked_notebooks,
                        }
                    )
                    await emit_progress(
                        phase="processing",
                        current_item=title,
                        current_index=index,
                    )
                    continue

            await ensure_not_canceled(
                current_item=title,
                current_index=index,
                item_phase="converting_pdf",
            )
            await emit_progress(
                phase="processing",
                current_item=title,
                current_index=index,
                item_phase="converting_pdf",
            )
            source = await create_source_placeholder(title, notebook_ids)
            try:
                pdf_result = await asyncio.to_thread(
                    convert_pdf,
                    str(pdf_path),
                    str(source.id),
                    selected_pdf_engine,
                )
                md_text = (pdf_result.get("content") or "").strip()
                if not md_text:
                    raise ZoteroImportError("PDF conversion returned empty markdown")

                actual_title = (
                    extract_paper_title_from_markdown(md_text)
                    or pdf_result.get("title")
                    or item.title
                )
                actual_title = actual_title.strip() if isinstance(actual_title, str) else item.title

                if skip_existing:
                    existing_source_id = await _find_existing_source_by_actual_title(
                        actual_title,
                        notebook_ids,
                        exclude_source_id=str(source.id),
                    )
                    if existing_source_id:
                        linked_notebooks = await _link_source_to_notebooks(
                            existing_source_id, notebook_ids
                        )
                        await _record_zotero_source(item, existing_source_id)
                        skipped += 1
                        results.append(
                            {
                                "title": actual_title,
                                "status": "skipped",
                                "reason": "duplicate_title",
                                "source_id": existing_source_id,
                                "item_key": item.item_key,
                                "attachment_key": item.attachment_key,
                                "linked_notebooks": linked_notebooks,
                            }
                        )
                        await emit_progress(
                            phase="processing",
                            current_item=actual_title,
                            current_index=index,
                        )
                        await source.delete()
                        continue
                source.title = actual_title
                await source.save()

                await ensure_not_canceled(
                    current_item=actual_title,
                    current_index=index,
                    item_phase="creating_source",
                )
                await emit_progress(
                    phase="processing",
                    current_item=actual_title,
                    current_index=index,
                    item_phase="creating_source",
                )
                marker = _build_zotero_marker(item)
                metadata_lines = [
                    f"# {actual_title}",
                    "",
                    f"- Zotero Collection: {item.collection_name}",
                    f"- Zotero Item Key: {item.item_key}",
                    f"- Zotero Attachment Key: {item.attachment_key}",
                ]
                if item.authors:
                    metadata_lines.append(f"- Authors: {', '.join(item.authors)}")
                if item.year:
                    metadata_lines.append(f"- Year: {item.year}")
                metadata_lines.extend(["", marker, "", md_text])

                await queue_source_processing(
                    source,
                    content_state={
                        "content": "\n".join(metadata_lines),
                        "title": actual_title,
                    },
                    notebook_ids=notebook_ids,
                    transformation_ids=default_transformation_ids,
                    embed=embed,
                )
                await _record_zotero_source(item, str(source.id))
                imported += 1
                results.append(
                    {
                        "title": actual_title,
                        "status": "imported",
                        "source_id": str(source.id),
                        "item_key": item.item_key,
                        "attachment_key": item.attachment_key,
                    }
                )
            except ZoteroImportCancelled:
                await source.delete()
                raise
            except Exception:
                await source.delete()
                raise
        except ZoteroImportCancelled:
            raise
        except Exception as exc:
            logger.exception(exc)
            failed += 1
            results.append(
                {
                    "title": title,
                    "status": "failed",
                    "error": str(exc),
                    "item_key": item.item_key,
                    "attachment_key": item.attachment_key,
                }
            )

        await emit_progress(
            phase="processing",
            current_item=title,
            current_index=index,
        )

    await emit_progress(phase="completed")

    return build_result()
