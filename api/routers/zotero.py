from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from api.command_service import CommandService
from open_notebook.integrations.zotero_import import ZoteroImportError, ZoteroImporter, import_zotero_collection

router = APIRouter(prefix="/zotero", tags=["zotero"])


class ZoteroImportRequest(BaseModel):
    collection_id: int
    notebook_ids: list[str] = Field(default_factory=list)
    embed: bool = True
    skip_existing: bool = True


class ZoteroImportJobResponse(BaseModel):
    job_id: str
    status: str
    message: str


class ZoteroImportJobStatusResponse(BaseModel):
    job_id: str
    status: str
    raw_status: str | None = None
    app: str | None = None
    name: str | None = None
    result: dict[str, Any] | None = None
    error_message: str | None = None
    created: str | None = None
    updated: str | None = None
    progress: dict[str, Any] | None = None
    args: dict[str, Any] | None = None
    context: dict[str, Any] | None = None
    cancel_requested: bool = False


class ZoteroImportJobCancelResponse(BaseModel):
    job_id: str
    cancel_requested: bool


@router.get("/collections")
async def list_collections() -> dict[str, Any]:
    try:
        importer = ZoteroImporter()
        collections = importer.list_collections()
        return {
            "collections": [
                {
                    "id": c.id,
                    "key": c.key,
                    "name": c.name,
                    "parent_id": c.parent_id,
                    "library_id": c.library_id,
                    "item_count": c.item_count,
                    "pdf_count": c.pdf_count,
                }
                for c in collections
            ]
        }
    except ZoteroImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import")
async def import_collection(req: ZoteroImportRequest) -> dict[str, Any]:
    try:
        return await import_zotero_collection(
            collection_id=req.collection_id,
            notebook_ids=req.notebook_ids,
            embed=req.embed,
            skip_existing=req.skip_existing,
        )
    except ZoteroImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/import/jobs", response_model=ZoteroImportJobResponse)
async def import_collection_job(req: ZoteroImportRequest) -> ZoteroImportJobResponse:
    try:
        import commands.zotero_commands  # noqa: F401

        job_id = await CommandService.submit_command_job(
            "open_notebook",
            "import_zotero_collection",
            req.model_dump(),
        )
        return ZoteroImportJobResponse(
            job_id=job_id,
            status="submitted",
            message="Zotero import job submitted successfully",
        )
    except ZoteroImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/import/jobs/{job_id}", response_model=ZoteroImportJobStatusResponse)
async def get_import_collection_job_status(
    job_id: str,
) -> ZoteroImportJobStatusResponse:
    try:
        status_data = await CommandService.get_command_status(job_id)
        return ZoteroImportJobStatusResponse(**status_data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/import/jobs", response_model=list[ZoteroImportJobStatusResponse])
async def list_import_collection_jobs(
    status_filter: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> list[ZoteroImportJobStatusResponse]:
    try:
        jobs = await CommandService.list_command_jobs(
            module_filter="open_notebook",
            command_filter="import_zotero_collection",
            status_filter=status_filter,
            limit=limit,
        )
        return [
            ZoteroImportJobStatusResponse(**job)
            for job in jobs
            if job.get("job_id")
        ]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/import/jobs/{job_id}/cancel", response_model=ZoteroImportJobCancelResponse)
async def cancel_import_collection_job(job_id: str) -> ZoteroImportJobCancelResponse:
    try:
        cancel_requested = await CommandService.cancel_command_job(job_id)
        return ZoteroImportJobCancelResponse(
            job_id=job_id,
            cancel_requested=cancel_requested,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/import/jobs/{job_id}/retry", response_model=ZoteroImportJobResponse)
async def retry_import_collection_job(job_id: str) -> ZoteroImportJobResponse:
    try:
        status_data = await CommandService.get_command_status(job_id)
        args = status_data.get("args")
        if not isinstance(args, dict):
            raise HTTPException(
                status_code=400,
                detail="Original job arguments are unavailable",
            )

        retry_args = {
            "collection_id": args.get("collection_id"),
            "notebook_ids": args.get("notebook_ids") or [],
            "embed": args.get("embed", True),
            "skip_existing": args.get("skip_existing", True),
        }
        if not retry_args["collection_id"]:
            raise HTTPException(
                status_code=400,
                detail="Original collection_id is unavailable",
            )

        import commands.zotero_commands  # noqa: F401

        new_job_id = await CommandService.submit_command_job(
            "open_notebook",
            "import_zotero_collection",
            retry_args,
        )
        return ZoteroImportJobResponse(
            job_id=new_job_id,
            status="submitted",
            message="Zotero import retry job submitted successfully",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
