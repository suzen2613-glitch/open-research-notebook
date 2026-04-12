from fastapi import APIRouter, HTTPException
from loguru import logger
from surreal_commands import submit_command

from api.models import (
    InsightCreationResponse,
    RefreshInsightRequest,
    NoteResponse,
    SaveAsNoteRequest,
    SourceInsightResponse,
)
from open_notebook.domain.notebook import SourceInsight
from open_notebook.domain.transformation import Transformation
from open_notebook.exceptions import InvalidInputError

router = APIRouter()


@router.get("/insights/{insight_id}", response_model=SourceInsightResponse)
async def get_insight(insight_id: str):
    """Get a specific insight by ID."""
    try:
        insight = await SourceInsight.get(insight_id)
        if not insight:
            raise HTTPException(status_code=404, detail="Insight not found")

        # Get source ID from the insight relationship
        source = await insight.get_source()

        return SourceInsightResponse(
            id=insight.id or "",
            source_id=source.id or "",
            insight_type=insight.insight_type,
            content=insight.content,
            transformation_id=insight.transformation_id,
            prompt_title=insight.prompt_title,
            can_refresh=bool(
                (insight.prompt_snapshot and insight.prompt_title)
                or insight.transformation_id
            ),
            created=str(insight.created),
            updated=str(insight.updated),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching insight {insight_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error fetching insight")


@router.delete("/insights/{insight_id}")
async def delete_insight(insight_id: str):
    """Delete a specific insight."""
    try:
        insight = await SourceInsight.get(insight_id)
        if not insight:
            raise HTTPException(status_code=404, detail="Insight not found")

        await insight.delete()

        return {"message": "Insight deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting insight {insight_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error deleting insight")


@router.post("/insights/{insight_id}/save-as-note", response_model=NoteResponse)
async def save_insight_as_note(insight_id: str, request: SaveAsNoteRequest):
    """Convert an insight to a note."""
    try:
        insight = await SourceInsight.get(insight_id)
        if not insight:
            raise HTTPException(status_code=404, detail="Insight not found")

        # Use the existing save_as_note method from the domain model
        note = await insight.save_as_note(request.notebook_id)

        return NoteResponse(
            id=note.id or "",
            title=note.title,
            content=note.content,
            note_type=note.note_type,
            board_column=note.board_column,
            source_id=note.source_id,
            source_insight_id=note.source_insight_id,
            created=str(note.created),
            updated=str(note.updated),
        )
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error saving insight {insight_id} as note: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Error saving insight as note"
        )


@router.post(
    "/insights/{insight_id}/refresh",
    response_model=InsightCreationResponse,
    status_code=202,
)
async def refresh_insight(
    insight_id: str, request: RefreshInsightRequest
) -> InsightCreationResponse:
    """Regenerate an existing insight using its stored prompt snapshot."""
    try:
        insight = await SourceInsight.get(insight_id)
        if not insight:
            raise HTTPException(status_code=404, detail="Insight not found")

        source = await insight.get_source()

        prompt_override = insight.prompt_snapshot
        insight_title = insight.prompt_title or insight.insight_type
        transformation_id = insight.transformation_id

        if not prompt_override and transformation_id:
            transformation = await Transformation.get(transformation_id)
            if transformation:
                prompt_override = transformation.prompt
                insight_title = transformation.title

        if not prompt_override or not insight_title:
            raise HTTPException(
                status_code=400,
                detail="This insight cannot be refreshed because no prompt metadata was stored",
            )

        command_id = submit_command(
            "open_notebook",
            "run_transformation",
            {
                "source_id": str(source.id),
                "transformation_id": transformation_id,
                "insight_title": insight_title,
                "prompt_override": prompt_override,
                "model_id": request.model_id,
            },
        )

        return InsightCreationResponse(
            status="pending",
            message="Insight refresh started",
            source_id=str(source.id),
            transformation_id=transformation_id,
            insight_title=insight_title,
            command_id=str(command_id),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error refreshing insight {insight_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error refreshing insight")
