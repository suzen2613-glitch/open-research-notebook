import time
from typing import Any

from loguru import logger
from pydantic import Field
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.integrations.zotero_import import (
    ZoteroImportCancelled,
    import_zotero_collection,
)


class ZoteroImportInput(CommandInput):
    collection_id: int
    notebook_ids: list[str] = Field(default_factory=list)
    embed: bool = True
    skip_existing: bool = True


class ZoteroImportOutput(CommandOutput):
    collection_id: int
    collection_name: str | None = None
    total: int
    imported: int
    skipped: int
    failed: int
    cancelled: bool = False
    results: list[dict[str, Any]] = Field(default_factory=list)
    processing_time: float


async def update_command_progress(
    command_id: str,
    progress: dict[str, Any],
) -> None:
    """Persist incremental job progress to the command record."""
    try:
        await repo_query(
            "UPDATE $command_id MERGE { progress: $progress }",
            {
                "command_id": ensure_record_id(command_id),
                "progress": progress,
            },
        )
    except Exception as exc:
        logger.warning(f"Failed to update Zotero import progress: {exc}")


async def is_command_cancel_requested(command_id: str) -> bool:
    try:
        records = await repo_query(
            "SELECT cancel_requested FROM $command_id",
            {"command_id": ensure_record_id(command_id)},
        )
        if not records:
            return False
        return bool(records[0].get("cancel_requested"))
    except Exception as exc:
        logger.warning(f"Failed to check Zotero import cancellation: {exc}")
        return False


@command("import_zotero_collection", app="open_notebook")
async def import_zotero_collection_command(
    input_data: ZoteroImportInput,
) -> ZoteroImportOutput:
    start_time = time.time()
    command_id = (
        str(input_data.execution_context.command_id)
        if input_data.execution_context
        else None
    )

    async def progress_callback(progress: dict[str, Any]) -> None:
        if command_id:
            await update_command_progress(command_id, progress)

    async def should_cancel() -> bool:
        if not command_id:
            return False
        return await is_command_cancel_requested(command_id)

    logger.info(
        "Starting Zotero import command for collection "
        f"{input_data.collection_id} into notebooks {input_data.notebook_ids}"
    )

    try:
        result = await import_zotero_collection(
            collection_id=input_data.collection_id,
            notebook_ids=input_data.notebook_ids,
            embed=input_data.embed,
            skip_existing=input_data.skip_existing,
            progress_callback=progress_callback,
            should_cancel=should_cancel,
        )
    except ZoteroImportCancelled as exc:
        result = exc.result
        if command_id:
            await update_command_progress(
                command_id,
                {
                    "phase": "canceled",
                    "collection_id": result.get("collection_id"),
                    "collection_name": result.get("collection_name"),
                    "total": result.get("total", 0),
                    "processed": (
                        result.get("imported", 0)
                        + result.get("skipped", 0)
                        + result.get("failed", 0)
                    ),
                    "imported": result.get("imported", 0),
                    "skipped": result.get("skipped", 0),
                    "failed": result.get("failed", 0),
                    "percentage": (
                        round(
                            (
                                (
                                    result.get("imported", 0)
                                    + result.get("skipped", 0)
                                    + result.get("failed", 0)
                                )
                                / result.get("total", 1)
                            )
                            * 100,
                            1,
                        )
                        if result.get("total")
                        else 100.0
                    ),
                    "current_item": None,
                    "current_index": None,
                    "item_phase": None,
                    "item_phase_index": None,
                    "item_phase_total": None,
                    "item_phase_percentage": None,
                    "error_message": None,
                    "cancel_requested": True,
                },
            )
    except Exception as exc:
        if command_id:
            await update_command_progress(
                command_id,
                {
                    "phase": "failed",
                    "total": 0,
                    "processed": 0,
                    "imported": 0,
                    "skipped": 0,
                    "failed": 0,
                    "percentage": 0,
                    "current_item": None,
                    "current_index": None,
                    "error_message": str(exc),
                },
            )
        raise

    processing_time = time.time() - start_time

    logger.info(
        "Completed Zotero import command for collection "
        f"{input_data.collection_id}: imported={result['imported']}, "
        f"skipped={result['skipped']}, failed={result['failed']}, "
        f"cancelled={result.get('cancelled', False)}"
    )

    return ZoteroImportOutput(
        collection_id=result["collection_id"],
        collection_name=result.get("collection_name"),
        total=result["total"],
        imported=result["imported"],
        skipped=result["skipped"],
        failed=result["failed"],
        cancelled=result.get("cancelled", False),
        results=result["results"],
        processing_time=processing_time,
    )
