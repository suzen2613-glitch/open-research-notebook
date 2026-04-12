import time
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from loguru import logger
from pydantic import BaseModel
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.database.repository import ensure_record_id
from open_notebook.domain.notebook import Source, SourceWikiCard
from open_notebook.domain.transformation import Transformation
from open_notebook.exceptions import ConfigurationError
from open_notebook.services.source_wiki_card import (
    generate_wiki_card_payload,
    serialize_source_wiki_card,
    sync_wiki_card_knowledge_registry,
)

try:
    from open_notebook.graphs.source import source_graph
    from open_notebook.graphs.transformation import graph as transform_graph
except ImportError as e:
    logger.error(f"Failed to import graphs: {e}")
    raise ValueError("graphs not available")


def full_model_dump(model):
    if isinstance(model, BaseModel):
        return model.model_dump()
    elif isinstance(model, dict):
        return {k: full_model_dump(v) for k, v in model.items()}
    elif isinstance(model, list):
        return [full_model_dump(item) for item in model]
    else:
        return model


class SourceProcessingInput(CommandInput):
    source_id: str
    content_state: Dict[str, Any]
    notebook_ids: List[str]
    transformations: List[str]
    embed: bool


class SourceProcessingOutput(CommandOutput):
    success: bool
    source_id: str
    embedded_chunks: int = 0
    insights_created: int = 0
    processing_time: float
    error_message: Optional[str] = None

async def resolve_transformations(transformation_ids: list[str]) -> list[Transformation]:
    """Resolve explicit transformations or fall back to defaults."""
    resolved: list[Transformation] = []

    if transformation_ids:
        for trans_id in transformation_ids:
            logger.info(f"Loading transformation: {trans_id}")
            transformation = await Transformation.get(trans_id)
            if not transformation:
                raise ValueError(f"Transformation '{trans_id}' not found")
            resolved.append(transformation)
        return resolved

    logger.info("No explicit transformations provided, loading defaults")
    defaults = await Transformation.get_all(order_by="name asc")
    resolved = [t for t in defaults if t.apply_default]
    logger.info(f"Loaded {len(resolved)} default transformations")
    return resolved



@command(
    "process_source",
    app="open_notebook",
    retry={
        "max_attempts": 15,  # Handle deep queues (workaround for SurrealDB v2 transaction conflicts)
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 120,  # Allow queue to drain
        "stop_on": [ValueError, ConfigurationError],  # Don't retry validation/config errors
        "retry_log_level": "debug",  # Avoid log noise during transaction conflicts
    },
)
async def process_source_command(
    input_data: SourceProcessingInput,
) -> SourceProcessingOutput:
    """
    Process source content using the source_graph workflow
    """
    start_time = time.time()

    try:
        logger.info(f"Starting source processing for source: {input_data.source_id}")
        logger.info(f"Notebook IDs: {input_data.notebook_ids}")
        logger.info(f"Transformations: {input_data.transformations}")
        logger.info(f"Embed: {input_data.embed}")

        # 1. Load transformation objects from IDs or defaults
        transformations = await resolve_transformations(input_data.transformations)

        logger.info(f"Loaded {len(transformations)} transformations")

        # 2. Get existing source record to update its command field
        source = await Source.get(input_data.source_id)
        if not source:
            raise ValueError(f"Source '{input_data.source_id}' not found")

        # Update source with command reference
        source.command = (
            ensure_record_id(input_data.execution_context.command_id)
            if input_data.execution_context
            else None
        )
        await source.save()

        logger.info(f"Updated source {source.id} with command reference")

        # 3. Process source with all notebooks
        logger.info(f"Processing source with {len(input_data.notebook_ids)} notebooks")

        # Execute source_graph with all notebooks
        result = await source_graph.ainvoke(
            {  # type: ignore[arg-type]
                "content_state": input_data.content_state,
                "notebook_ids": input_data.notebook_ids,  # Use notebook_ids (plural) as expected by SourceState
                "apply_transformations": transformations,
                "embed": input_data.embed,
                "source_id": input_data.source_id,  # Add the source_id to the state
            }
        )

        processed_source = result["source"]

        # 4. Gather processing results (notebook associations handled by source_graph)
        # Note: embedding is fire-and-forget (async job), so we can't query the
        # count here — it hasn't completed yet. The embed_source_command logs
        # the actual count when it finishes.
        insights_list = await processed_source.get_insights()
        insights_created = len(insights_list)

        processing_time = time.time() - start_time
        embed_status = "submitted" if input_data.embed else "skipped"
        logger.info(
            f"Successfully processed source: {processed_source.id} in {processing_time:.2f}s"
        )
        logger.info(
            f"Created {insights_created} insights, embedding {embed_status}"
        )

        return SourceProcessingOutput(
            success=True,
            source_id=str(processed_source.id),
            embedded_chunks=0,
            insights_created=insights_created,
            processing_time=processing_time,
        )

    except ValueError as e:
        # Validation errors are permanent failures - don't retry
        processing_time = time.time() - start_time
        logger.error(f"Source processing failed: {e}")
        return SourceProcessingOutput(
            success=False,
            source_id=input_data.source_id,
            processing_time=processing_time,
            error_message=str(e),
        )
    except Exception as e:
        # Transient failure - will be retried (surreal-commands logs final failure)
        logger.debug(
            f"Transient error processing source {input_data.source_id}: {e}"
        )
        raise


# =============================================================================
# RUN TRANSFORMATION COMMAND
# =============================================================================


class RunTransformationInput(CommandInput):
    """Input for running a transformation on an existing source."""

    source_id: str
    transformation_id: Optional[str] = None
    insight_title: Optional[str] = None
    prompt_override: Optional[str] = None
    model_id: Optional[str] = None


class RunTransformationOutput(CommandOutput):
    """Output from transformation command."""

    success: bool
    source_id: str
    transformation_id: Optional[str] = None
    processing_time: float
    error_message: Optional[str] = None


@command(
    "run_transformation",
    app="open_notebook",
    retry={
        "max_attempts": 5,
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 60,
        "stop_on": [ValueError, ConfigurationError],  # Don't retry validation/config errors
        "retry_log_level": "debug",
    },
)
async def run_transformation_command(
    input_data: RunTransformationInput,
) -> RunTransformationOutput:
    """
    Run a transformation on an existing source to generate an insight.

    This command runs the transformation graph which:
    1. Loads the source and transformation
    2. Calls the LLM to generate insight content
    3. Creates the insight via create_insight command (fire-and-forget)

    Use this command for UI-triggered insight generation to avoid blocking
    the HTTP request while the LLM processes.

    Retry Strategy:
    - Retries up to 5 times for transient failures (network, timeout, etc.)
    - Uses exponential-jitter backoff (1-60s)
    - Does NOT retry permanent failures (ValueError for validation errors)
    """
    start_time = time.time()

    try:
        logger.info(
            f"Running transformation {input_data.transformation_id} "
            f"on source {input_data.source_id}"
        )

        # Load source
        source = await Source.get(input_data.source_id)
        if not source:
            raise ValueError(f"Source '{input_data.source_id}' not found")

        transformation_id = input_data.transformation_id
        prompt_override = input_data.prompt_override
        insight_title = input_data.insight_title

        if transformation_id:
            transformation = await Transformation.get(transformation_id)
            if not transformation:
                raise ValueError(f"Transformation '{transformation_id}' not found")
            prompt_override = prompt_override or transformation.prompt
            insight_title = insight_title or transformation.title
        else:
            if not prompt_override or not insight_title:
                raise ValueError(
                    "Custom transformations require both prompt_override and insight_title"
                )
            transformation = SimpleNamespace(
                id=None,
                title=insight_title,
                prompt=prompt_override,
            )

        # Run transformation graph (includes LLM call + insight creation)
        await transform_graph.ainvoke(
            input=dict(
                source=source,
                transformation=transformation,
                transformation_id=transformation_id,
                insight_title=insight_title,
                prompt_override=prompt_override,
            ),
            config={"configurable": {"model_id": input_data.model_id}},
        )

        processing_time = time.time() - start_time
        logger.info(
            f"Successfully ran transformation {input_data.transformation_id} "
            f"on source {input_data.source_id} in {processing_time:.2f}s"
        )

        return RunTransformationOutput(
            success=True,
            source_id=input_data.source_id,
            transformation_id=transformation_id,
            processing_time=processing_time,
        )

    except ValueError as e:
        # Validation errors are permanent failures - don't retry
        processing_time = time.time() - start_time
        logger.error(
            f"Failed to run transformation {input_data.transformation_id or input_data.insight_title} "
            f"on source {input_data.source_id}: {e}"
        )
        return RunTransformationOutput(
            success=False,
            source_id=input_data.source_id,
            transformation_id=input_data.transformation_id,
            processing_time=processing_time,
            error_message=str(e),
        )
    except Exception as e:
        # Transient failure - will be retried (surreal-commands logs final failure)
        logger.debug(
            f"Transient error running transformation {input_data.transformation_id or input_data.insight_title} "
            f"on source {input_data.source_id}: {e}"
        )
        raise


class GenerateWikiCardInput(CommandInput):
    source_id: str
    wiki_card_id: str
    model_id: Optional[str] = None


class GenerateWikiCardOutput(CommandOutput):
    success: bool
    source_id: str
    wiki_card_id: str
    processing_time: float
    error_message: Optional[str] = None


@command("generate_wiki_card", app="open_notebook")
async def generate_wiki_card_command(
    input_data: GenerateWikiCardInput,
) -> GenerateWikiCardOutput:
    start_time = time.time()

    try:
        source = await Source.get(input_data.source_id)
        if not source:
            raise ValueError(f"Source '{input_data.source_id}' not found")

        wiki_card = await SourceWikiCard.get(input_data.wiki_card_id)
        if not wiki_card:
            raise ValueError(f"Wiki card '{input_data.wiki_card_id}' not found")

        payload = await generate_wiki_card_payload(source, input_data.model_id)

        wiki_card.notebook_ids = payload["notebook_ids"]
        wiki_card.source_title = payload["source_title"]
        wiki_card.title = payload["title"]
        wiki_card.short_title = payload["short_title"]
        wiki_card.canonical_title = payload["canonical_title"]
        wiki_card.slug = payload["slug"]
        wiki_card.authors = payload["authors"]
        wiki_card.year = payload["year"]
        wiki_card.venue = payload["venue"]
        wiki_card.paper_type = payload["paper_type"]
        wiki_card.domains = payload["domains"]
        wiki_card.summary_text = payload["summary_text"]
        wiki_card.topics = payload["topics"]
        wiki_card.methods = payload["methods"]
        wiki_card.problems = payload["problems"]
        wiki_card.contributions = payload["contributions"]
        wiki_card.limitations = payload["limitations"]
        wiki_card.keywords = payload["keywords"]
        wiki_card.moc_groups = payload["moc_groups"]
        wiki_card.recommended_entry_points = payload["recommended_entry_points"]
        wiki_card.is_key_paper = payload["is_key_paper"]
        wiki_card.concept_ids = payload["concept_ids"]
        wiki_card.concept_names = payload["concept_names"]
        wiki_card.core_concept_ids = payload["core_concept_ids"]
        wiki_card.question_ids = payload["question_ids"]
        wiki_card.question_names = payload["question_names"]
        wiki_card.related_sources = payload["related_sources"]
        wiki_card.relation_edges = payload["relation_edges"]
        wiki_card.display_language = payload["display_language"]
        wiki_card.canonical_language = payload["canonical_language"]
        wiki_card.extraction_confidence = payload["extraction_confidence"]
        wiki_card.evidence_snippets = payload["evidence_snippets"]
        wiki_card.summary_source_insight_id = payload["summary_source_insight_id"]
        wiki_card.prompt_snapshot = payload["prompt_snapshot"]
        wiki_card.model_id = payload["model_id"]
        wiki_card.command_id = (
            str(input_data.execution_context.command_id)
            if input_data.execution_context and input_data.execution_context.command_id
            else wiki_card.command_id
        )
        wiki_card.status = "completed"
        wiki_card.error_message = None
        serialized_wiki_card = await serialize_source_wiki_card(wiki_card)
        wiki_card.obsidian_markdown = serialized_wiki_card["obsidian_markdown"]
        wiki_card.obsidian_frontmatter = serialized_wiki_card["obsidian_frontmatter"]
        await wiki_card.save()
        await sync_wiki_card_knowledge_registry(serialized_wiki_card)

        processing_time = time.time() - start_time
        return GenerateWikiCardOutput(
            success=True,
            source_id=input_data.source_id,
            wiki_card_id=input_data.wiki_card_id,
            processing_time=processing_time,
        )
    except Exception as e:
        try:
            wiki_card = await SourceWikiCard.get(input_data.wiki_card_id)
            wiki_card.status = "failed"
            wiki_card.error_message = str(e)
            if input_data.execution_context and input_data.execution_context.command_id:
                wiki_card.command_id = str(input_data.execution_context.command_id)
            await wiki_card.save()
        except Exception as status_error:
            logger.warning(
                f"Failed to persist wiki card failure state for {input_data.wiki_card_id}: {status_error}"
            )

        processing_time = time.time() - start_time
        logger.error(
            f"Wiki card generation failed for source {input_data.source_id}: {e}"
        )
        return GenerateWikiCardOutput(
            success=False,
            source_id=input_data.source_id,
            wiki_card_id=input_data.wiki_card_id,
            processing_time=processing_time,
            error_message=str(e),
        )
