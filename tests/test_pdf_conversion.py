import io
import zipfile
from pathlib import Path

from open_notebook.utils import pdf_assets, pdf_conversion, pdf_mineru_cloud


class _FakeResponse:
    def __init__(self, *, status_code: int = 200, json_data=None, content: bytes = b""):
        self.status_code = status_code
        self._json_data = json_data
        self.content = content

    def json(self):
        return self._json_data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FakeMineruCloudClient:
    def __init__(self, *args, **kwargs):
        self.poll_count = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, url, headers=None, json=None):
        assert url.endswith("/api/v4/file-urls/batch")
        assert headers["Authorization"].startswith("Bearer ")
        assert json["files"][0]["name"].endswith(".pdf")
        return _FakeResponse(
            json_data={
                "code": 0,
                "msg": "ok",
                "data": {
                    "batch_id": "batch:test",
                    "file_urls": [{"file_url": "https://upload.example/test.pdf"}],
                },
            }
        )

    def get(self, url, headers=None, follow_redirects=False):
        if url.endswith("/api/v4/extract-results/batch/batch:test"):
            self.poll_count += 1
            if self.poll_count == 1:
                return _FakeResponse(
                    json_data={"code": 0, "msg": "ok", "data": {"state": "processing"}}
                )
            return _FakeResponse(
                json_data={
                    "code": 0,
                    "msg": "ok",
                    "data": {
                        "extract_result": [
                            {
                                "state": "done",
                                "full_zip_url": "https://download.example/full.zip",
                            }
                        ]
                    },
                }
            )

        if url == "https://download.example/full.zip":
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, "w") as zip_file:
                zip_file.writestr("full.md", "![Figure](images/page1.png)\n\nConverted body")
                zip_file.writestr("images/page1.png", b"png-bytes")
            return _FakeResponse(content=archive.getvalue())

        raise AssertionError(f"Unexpected GET {url}")


def _fake_requests_put(url, data=None, headers=None, timeout=None):
    assert url == "https://upload.example/test.pdf"
    assert data
    return _FakeResponse(status_code=200)


def _fake_requests_get(url, timeout=None):
    assert url == "https://download.example/full.zip"
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zip_file:
        zip_file.writestr("full.md", "![Figure](images/page1.png)\n\nConverted body")
        zip_file.writestr("images/page1.png", b"png-bytes")
    return _FakeResponse(content=archive.getvalue())


def test_get_pdf_engine_order_includes_cloud_and_local_fallbacks():
    assert pdf_conversion.get_pdf_engine_order("mineru_cloud") == [
        "mineru_cloud",
        "mineru",
        "marker",
    ]
    assert pdf_conversion.get_pdf_engine_order("mineru") == ["mineru", "marker"]


def test_convert_pdf_with_mineru_cloud_extracts_assets_and_rewrites_urls(
    monkeypatch, tmp_path
):
    pdf_path = tmp_path / "sample.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 test")

    image_root = tmp_path / "images"
    monkeypatch.setattr(pdf_assets, "IMAGES_FOLDER", str(image_root))
    monkeypatch.setattr(pdf_assets, "IMAGE_SERVER_URL", "/api/images")
    monkeypatch.setattr(pdf_mineru_cloud, "MINERU_CLOUD_API_TOKEN", "token")
    monkeypatch.setattr(pdf_mineru_cloud, "MINERU_CLOUD_API_BASE_URL", "https://mineru.net")
    monkeypatch.setattr(pdf_mineru_cloud, "MINERU_CLOUD_TIMEOUT_SECONDS", 10)
    monkeypatch.setattr(pdf_mineru_cloud, "MINERU_CLOUD_POLL_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(pdf_mineru_cloud.httpx, "Client", _FakeMineruCloudClient)
    monkeypatch.setattr(pdf_mineru_cloud.requests, "put", _fake_requests_put)
    monkeypatch.setattr(pdf_mineru_cloud.requests, "get", _fake_requests_get)

    result = pdf_mineru_cloud.convert_pdf_with_mineru_cloud(
        str(pdf_path), "source:test"
    )

    assert result["title"] == "sample"
    assert "Converted body" in result["content"]
    assert "/api/images/source_test/images/page1.png" in result["content"]
    assert (image_root / "source_test" / "images" / "page1.png").exists()
