from types import SimpleNamespace

import pytest

from open_notebook.exceptions import InvalidInputError
from open_notebook.graphs.source import should_replace_source_title
from open_notebook.services import source_ingest
from open_notebook.services.source_ingest import (
    PROVISIONAL_SOURCE_TITLE,
    build_placeholder_asset,
    derive_placeholder_title,
)


def test_should_replace_source_title_preserves_custom_title():
    assert not should_replace_source_title("My Custom Title", "PDF Title")


def test_should_replace_source_title_replaces_processing_placeholder():
    assert should_replace_source_title(PROVISIONAL_SOURCE_TITLE, "PDF Title")


def test_should_replace_source_title_replaces_file_name_placeholder():
    assert should_replace_source_title(
        "attention is all you need",
        "Attention Is All You Need",
        file_path="/tmp/attention_is_all_you_need.pdf",
    )


def test_should_replace_source_title_preserves_true_custom_title():
    assert not should_replace_source_title(
        "My Reading Copy",
        "Attention Is All You Need",
        file_path="/tmp/attention_is_all_you_need.pdf",
    )


def test_derive_placeholder_title_prefers_explicit_title():
    title = derive_placeholder_title(
        "Hand-picked Title",
        {"file_path": "/tmp/paper.pdf", "title": "Ignored Extracted Title"},
    )
    assert title == "Hand-picked Title"


def test_derive_placeholder_title_uses_file_name_when_title_missing():
    title = derive_placeholder_title(None, {"file_path": "/tmp/attention_is_all_you_need.pdf"})
    assert title == "attention is all you need"


def test_build_placeholder_asset_uses_file_path():
    asset = build_placeholder_asset({"file_path": "/tmp/paper.pdf"})
    assert asset is not None
    assert asset.file_path == "/tmp/paper.pdf"
    assert asset.url is None


def test_build_placeholder_asset_uses_url():
    asset = build_placeholder_asset({"url": "https://example.com/paper"})
    assert asset is not None
    assert asset.file_path is None
    assert asset.url == "https://example.com/paper"


@pytest.mark.asyncio
async def test_validate_notebook_ids_rejects_general_notebooks(monkeypatch):
    async def fake_get(notebook_id: str):
        return SimpleNamespace(id=notebook_id, notebook_type="general")

    monkeypatch.setattr(source_ingest.Notebook, "get", fake_get)

    with pytest.raises(InvalidInputError, match="General notebooks don't support sources"):
        await source_ingest.validate_notebook_ids(["notebook:general"])
