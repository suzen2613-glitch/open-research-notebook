import asyncio
from dataclasses import dataclass
from typing import Any, Optional

from loguru import logger
from surreal_commands import execute_command_sync, submit_command

from commands.source_commands import SourceProcessingInput
from open_notebook.database.repository import ensure_record_id
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.domain.transformation import Transformation


@dataclass
class SourceIngestResult:
    source: Source
    command_id: Optional[str] = None
    status: Optional[str] = None
    processing_info: Optional[dict[str, Any]] = None


async def validate_notebook_ids(notebook_ids: list[str]) -> None:
    for notebook_id in notebook_ids:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise ValueError(f"Notebook {notebook_id} not found")


async def resolve_transformation_ids(transformation_ids: list[str]) -> list[str]:
    if transformation_ids:
        for trans_id in transformation_ids:
            transformation = await Transformation.get(trans_id)
            if not transformation:
                raise ValueError(f"Transformation {trans_id} not found")
        return transformation_ids

    default_transformations = await Transformation.get_all(order_by="name asc")
    resolved = [
        str(transformation.id)
        for transformation in default_transformations
        if transformation.apply_default and transformation.id
    ]
    logger.info(
        f"No explicit transformations provided, using default transformations: {resolved}"
    )
    return resolved


async def create_source_placeholder(
    title: Optional[str],
    notebook_ids: list[str],
) -> Source:
    attempts = 3
    for attempt in range(1, attempts + 1):
        source = Source(
            title=title or "Processing...",
            topics=[],
        )
        try:
            await source.save()
            for notebook_id in notebook_ids:
                await source.add_to_notebook(notebook_id)
            return source
        except RuntimeError as exc:
            error_message = str(exc).lower()
            if "transaction" not in error_message and "conflict" not in error_message:
                raise
            if attempt == attempts:
                raise
            delay_seconds = 0.2 * attempt
            logger.warning(
                "Transaction conflict while creating source placeholder "
                f"(attempt {attempt}/{attempts}), retrying in {delay_seconds:.1f}s"
            )
            await asyncio.sleep(delay_seconds)

    raise RuntimeError("Failed to create source placeholder after retries")


async def queue_source_processing(
    source: Source,
    *,
    content_state: dict[str, Any],
    notebook_ids: list[str],
    transformation_ids: list[str],
    embed: bool,
) -> str:
    import commands.source_commands  # noqa: F401

    command_input = SourceProcessingInput(
        source_id=str(source.id),
        content_state=content_state,
        notebook_ids=notebook_ids,
        transformations=transformation_ids,
        embed=embed,
    )

    command_id = str(
        submit_command(
            "open_notebook",
            "process_source",
            command_input.model_dump(),
        )
    )
    source.command = ensure_record_id(command_id)
    await source.save()
    return command_id


async def process_source_sync_existing(
    source: Source,
    *,
    content_state: dict[str, Any],
    notebook_ids: list[str],
    transformation_ids: list[str],
    embed: bool,
    timeout: int = 300,
) -> Source:
    import commands.source_commands  # noqa: F401

    command_input = SourceProcessingInput(
        source_id=str(source.id),
        content_state=content_state,
        notebook_ids=notebook_ids,
        transformations=transformation_ids,
        embed=embed,
    )

    result = await asyncio.to_thread(
        execute_command_sync,
        "open_notebook",
        "process_source",
        command_input.model_dump(),
        timeout=timeout,
    )
    if not result.is_success():
        raise RuntimeError(result.error_message or "Source processing failed")

    processed_source = await Source.get(str(source.id))
    if not processed_source:
        raise RuntimeError("Processed source not found")
    return processed_source


async def ingest_source_content(
    *,
    title: Optional[str],
    notebook_ids: list[str],
    content_state: dict[str, Any],
    transformation_ids: list[str],
    embed: bool,
    async_processing: bool,
) -> SourceIngestResult:
    await validate_notebook_ids(notebook_ids)
    resolved_transformation_ids = await resolve_transformation_ids(transformation_ids)
    source = await create_source_placeholder(title, notebook_ids)

    try:
        if async_processing:
            command_id = await queue_source_processing(
                source,
                content_state=content_state,
                notebook_ids=notebook_ids,
                transformation_ids=resolved_transformation_ids,
                embed=embed,
            )
            return SourceIngestResult(
                source=source,
                command_id=command_id,
                status="new",
                processing_info={"async": True, "queued": True},
            )

        processed_source = await process_source_sync_existing(
            source,
            content_state=content_state,
            notebook_ids=notebook_ids,
            transformation_ids=resolved_transformation_ids,
            embed=embed,
        )
        return SourceIngestResult(source=processed_source)
    except Exception:
        try:
            await source.delete()
        except Exception as cleanup_error:
            logger.warning(
                f"Failed to clean up source placeholder {source.id}: {cleanup_error}"
            )
        raise
