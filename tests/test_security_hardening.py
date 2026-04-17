from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile

from api.routers import notebooks as notebooks_router
from api.routers import sources as sources_router


def test_notebooks_order_by_rejects_invalid_input():
    app = FastAPI()
    app.include_router(notebooks_router.router, prefix="/api")
    client = TestClient(app)

    response = client.get("/api/notebooks", params={"order_by": "updated desc; DELETE notebook"})

    assert response.status_code == 400
    assert "order_by must be one of" in response.json()["detail"]


def test_generate_unique_filename_strips_path_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr(sources_router, "UPLOADS_FOLDER", str(tmp_path))

    saved_path = sources_router.generate_unique_filename("../../../../tmp/test.pdf", str(tmp_path))

    assert Path(saved_path).parent == tmp_path.resolve()
    assert Path(saved_path).name == "test.pdf"


def test_validate_server_upload_path_rejects_paths_outside_uploads(tmp_path, monkeypatch):
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()
    secret_file = tmp_path / "secret.txt"
    secret_file.write_text("do-not-read", encoding="utf-8")
    monkeypatch.setattr(sources_router, "UPLOADS_FOLDER", str(uploads_dir))

    try:
        sources_router.validate_server_upload_path(str(secret_file))
        assert False, "Expected HTTPException for file outside uploads"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400
        assert "inside the uploads directory" in getattr(exc, "detail", "")


@patch("api.routers.sources.ingest_source_content", new_callable=AsyncMock)
def test_create_source_json_rejects_file_path_outside_uploads(mock_ingest, tmp_path, monkeypatch):
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()
    monkeypatch.setattr(sources_router, "UPLOADS_FOLDER", str(uploads_dir))
    outside_file = tmp_path / "outside.pdf"
    outside_file.write_bytes(b"%PDF-1.4")
    app = FastAPI()
    app.include_router(sources_router.router, prefix="/api")
    client = TestClient(app)
    response = client.post(
        "/api/sources/json",
        json={
            "type": "upload",
            "file_path": str(outside_file),
            "notebooks": [],
        },
    )

    assert response.status_code == 400
    assert "uploads directory" in response.json()["detail"]
    mock_ingest.assert_not_awaited()


def test_save_uploaded_file_sanitizes_filename(tmp_path, monkeypatch):
    monkeypatch.setattr(sources_router, "UPLOADS_FOLDER", str(tmp_path))
    upload = UploadFile(filename="../../sneaky.pdf", file=BytesIO(b"pdf"))

    import asyncio

    saved_path = asyncio.run(sources_router.save_uploaded_file(upload))

    assert Path(saved_path).parent == tmp_path.resolve()
    assert Path(saved_path).name == "sneaky.pdf"
