from typing import List

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from api.models import SourceEmbeddingResponse
from open_notebook.domain.notebook import Source, SourceEmbedding

router = APIRouter()


def _to_response(embedding: SourceEmbedding) -> SourceEmbeddingResponse:
    source_id = embedding.source or ""
    return SourceEmbeddingResponse(
        id=embedding.id or "",
        source_id=source_id,
        order=embedding.order,
        section=embedding.section,
        char_start=embedding.char_start,
        char_end=embedding.char_end,
        content=embedding.content,
        created=str(embedding.created),
        updated=str(embedding.updated),
    )


@router.get(
    "/source-embeddings/{embedding_id}",
    response_model=SourceEmbeddingResponse,
)
async def get_source_embedding(embedding_id: str):
    """Fetch a single embedded source excerpt by ID."""
    try:
        embedding = await SourceEmbedding.get(embedding_id)
        if not embedding:
            raise HTTPException(status_code=404, detail="Evidence not found")
        return _to_response(embedding)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching source embedding {embedding_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error fetching evidence")


@router.get(
    "/sources/{source_id}/evidence",
    response_model=List[SourceEmbeddingResponse],
)
async def get_source_evidence(
    source_id: str,
    limit: int = Query(12, ge=1, le=50, description="Maximum evidence chunks"),
):
    """Fetch ordered evidence chunks for a source."""
    try:
        source = await Source.get(source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Source not found")
        embeddings = await source.get_embeddings(limit=limit)
        return [_to_response(embedding) for embedding in embeddings]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching source evidence for {source_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error fetching source evidence")
