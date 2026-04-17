import pytest

from open_notebook.services import source_references


def test_extract_reference_entries_from_references_section():
    markdown = """
# Test Paper

Intro paragraph.

## References
[1] Vaswani, A., et al. Attention Is All You Need. NeurIPS, 2017.
[2] Brown, T., et al. Language Models are Few-Shot Learners. NeurIPS, 2020.
"""

    entries = source_references.extract_reference_entries(markdown)

    assert len(entries) == 2
    assert "Attention Is All You Need" in entries[0]
    assert "Language Models are Few-Shot Learners" in entries[1]


def test_extract_reference_title_prefers_quoted_title_when_available():
    reference = 'Smith, J. "Attention Is All You Need". Advances in AI, 2017.'

    assert (
        source_references.extract_reference_title(reference)
        == "Attention Is All You Need"
    )


@pytest.mark.asyncio
async def test_build_source_reference_connections_matches_internal_sources(monkeypatch):
    class FakeSource:
        id = "source:a"
        title = "Paper A"
        full_text = """
# Paper A

## References
[1] Vaswani, A., et al. Attention Is All You Need. NeurIPS, 2017.
[2] Brown, T., et al. Language Models are Few-Shot Learners. NeurIPS, 2020.
"""

        async def get_notebook_ids(self):
            return ["notebook:test"]

    async def fake_source_get(source_id):
        assert source_id == "source:a"
        return FakeSource()

    async def fake_repo_query(query, vars=None):
        return [
            {
                "id": "source:a",
                "title": "Paper A",
                "full_text": FakeSource.full_text,
                "asset": None,
                "notebook_ids": ["notebook:test"],
            },
            {
                "id": "source:b",
                "title": "Attention Is All You Need",
                "full_text": "# Attention Is All You Need",
                "asset": None,
                "notebook_ids": ["notebook:test"],
            },
        ]

    monkeypatch.setattr(source_references.Source, "get", fake_source_get)
    monkeypatch.setattr(source_references, "repo_query", fake_repo_query)

    result = await source_references.build_source_reference_connections("source:a")

    assert result["references_extracted"] == 2
    assert len(result["citations_in_notebook"]) == 1
    assert result["citations_in_notebook"][0]["source_id"] == "source:b"
    assert len(result["reference_candidates"]) == 1
    assert (
        result["reference_candidates"][0]["normalized_title"]
        == "language models are few shot learners"
    )


@pytest.mark.asyncio
async def test_build_source_reference_connections_finds_cited_by_matches(monkeypatch):
    class FakeSource:
        id = "source:b"
        title = "Attention Is All You Need"
        full_text = "# Attention Is All You Need"

        async def get_notebook_ids(self):
            return ["notebook:test"]

    async def fake_source_get(source_id):
        assert source_id == "source:b"
        return FakeSource()

    async def fake_repo_query(query, vars=None):
        return [
            {
                "id": "source:a",
                "title": "Paper A",
                "full_text": """
# Paper A

## References
[1] Vaswani, A., et al. Attention Is All You Need. NeurIPS, 2017.
""",
                "asset": None,
                "notebook_ids": ["notebook:test"],
            },
            {
                "id": "source:b",
                "title": "Attention Is All You Need",
                "full_text": "# Attention Is All You Need",
                "asset": None,
                "notebook_ids": ["notebook:test"],
            },
        ]

    monkeypatch.setattr(source_references.Source, "get", fake_source_get)
    monkeypatch.setattr(source_references, "repo_query", fake_repo_query)

    result = await source_references.build_source_reference_connections("source:b")

    assert len(result["cited_by_in_notebook"]) == 1
    assert result["cited_by_in_notebook"][0]["source_id"] == "source:a"
