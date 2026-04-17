from typing import List, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from surreal_commands import submit_command

from api.models import (
    CreateSourceSummaryRequest,
    InsightCreationResponse,
    NotebookSourceSummaryResponse,
    SourceInsightResponse,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.services.source_summary import (
    SOURCE_SUMMARY_PROMPT,
    SOURCE_SUMMARY_TITLE,
)

router = APIRouter()


def _serialize_insight(
    insight: Optional[dict], fallback_source_id: str
) -> Optional[SourceInsightResponse]:
    if not insight or not insight.get("id"):
        return None

    source_id = str(insight.get("source") or fallback_source_id)

    return SourceInsightResponse(
        id=str(insight.get("id", "")),
        source_id=source_id,
        insight_type=insight.get("insight_type", SOURCE_SUMMARY_TITLE),
        content=insight.get("content", ""),
        transformation_id=insight.get("transformation_id"),
        prompt_title=insight.get("prompt_title"),
        can_refresh=bool(
            (insight.get("prompt_snapshot") and insight.get("prompt_title"))
            or insight.get("transformation_id")
        ),
        created=str(insight.get("created", "")),
        updated=str(insight.get("updated", "")),
    )


@router.get(
    "/notebooks/{notebook_id}/summaries",
    response_model=List[NotebookSourceSummaryResponse],
)
async def get_notebook_summaries(notebook_id: str):
    """Return one canonical summary slot per source in a notebook."""
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        rows = await repo_query(
            """
            SELECT id, title, created, updated,
                (
                    SELECT id, source, insight_type, content, transformation_id,
                        prompt_title, prompt_snapshot, created, updated
                    FROM source_insight
                    WHERE source = $parent.id
                      AND (insight_type = $summary_title OR prompt_title = $summary_title)
                    ORDER BY updated DESC
                    LIMIT 1
                )[0] AS summary
            FROM (SELECT VALUE in FROM reference WHERE out = $notebook_id)
            ORDER BY updated DESC
            """,
            {
                "notebook_id": ensure_record_id(notebook_id),
                "summary_title": SOURCE_SUMMARY_TITLE,
            },
        )

        items = [
            NotebookSourceSummaryResponse(
                source_id=str(row.get("id", "")),
                source_title=row.get("title"),
                source_created=str(row.get("created", "")),
                source_updated=str(row.get("updated", "")),
                summary=_serialize_insight(row.get("summary"), str(row.get("id", ""))),
            )
            for row in rows
        ]
        items.sort(
            key=lambda item: (
                item.summary.updated if item.summary else item.source_updated
            ),
            reverse=True,
        )
        return items
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error fetching summaries for notebook {notebook_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error fetching summaries: {str(e)}"
        )


@router.post(
    "/sources/{source_id}/summary",
    response_model=InsightCreationResponse,
    status_code=202,
)
async def create_source_summary(
    source_id: str, request: CreateSourceSummaryRequest
) -> InsightCreationResponse:
    """Generate the canonical summary for a source."""
    try:
        source = await Source.get(source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Source not found")

        command_id = submit_command(
            "open_notebook",
            "run_transformation",
            {
                "source_id": source_id,
                "insight_title": SOURCE_SUMMARY_TITLE,
                "prompt_override": SOURCE_SUMMARY_PROMPT,
                "model_id": request.model_id,
            },
        )

        return InsightCreationResponse(
            status="pending",
            message="Summary generation started",
            source_id=source_id,
            transformation_id=None,
            insight_title=SOURCE_SUMMARY_TITLE,
            command_id=str(command_id),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting summary generation for source {source_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error starting summary generation: {str(e)}"
        )
