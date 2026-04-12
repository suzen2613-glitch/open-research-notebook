import pytest

from open_notebook.services import source_dedupe


def test_extract_paper_title_from_markdown_prefers_real_heading_over_metadata():
    markdown = """# Wu et al. - 2023 - A comprehensive study of retrieval and tool use for large language model agents

- Zotero Collection: Test
- Zotero Item Key: ABC
- Zotero Attachment Key: XYZ

<!-- zotero:item_key=ABC;attachment_key=XYZ;collection_id=1 -->

# A Comprehensive Study of Retrieval and Tool Use for Large Language Model Agents

Author One, Author Two

## Abstract
Body
"""
    assert (
        source_dedupe.extract_paper_title_from_markdown(markdown)
        == "A Comprehensive Study of Retrieval and Tool Use for Large Language Model Agents"
    )


def test_normalize_paper_title_handles_spacing_and_punctuation():
    title_a = "Large Language Models: A Review"
    title_b = "large language models a review"
    assert source_dedupe.normalize_paper_title(title_a) == source_dedupe.normalize_paper_title(title_b)


def test_cleanup_filename_title_strips_export_artifacts():
    cleaned = source_dedupe.cleanup_filename_title(
        "ArXiv - 2025 - Doe - Large Language Models for Tool Use and Planning.md"
    )
    assert cleaned == "Large Language Models for Tool Use and Planning"


def test_get_effective_source_title_prefers_full_text_heading():
    source_like = {
        "title": "tool_use_agents.md",
        "full_text": "# Tool-Augmented Language Models for Reliable Multi-Step Agents\n\nBody",
    }
    assert (
        source_dedupe.get_effective_source_title(source_like)
        == "Tool-Augmented Language Models for Reliable Multi-Step Agents"
    )


def test_extract_paper_title_ignores_venue_headers_and_online_headers():
    markdown = """Available online at www.sciencedirect.com

Journal of Computational Physics

# A Comprehensive Study of Retrieval and Tool Use for Large Language Model Agents

Abstract
"""
    assert (
        source_dedupe.extract_paper_title_from_markdown(markdown)
        == "A Comprehensive Study of Retrieval and Tool Use for Large Language Model Agents"
    )


def test_extract_paper_title_ignores_keywords_line_when_heading_exists():
    markdown = """# A comprehensive study of retrieval and tool use for large language model agents

Keywords: large language models; retrieval augmented generation; tool use
"""
    assert (
        source_dedupe.extract_paper_title_from_markdown(markdown)
        == "A comprehensive study of retrieval and tool use for large language model agents"
    )


def test_extract_paper_title_ignores_affiliation_line_when_heading_exists():
    markdown = """# Long-Context Language Models with Retrieval for Multi-Document Reasoning

Hiroe Miyake is with the Earthquake Research Institute, The University of Tokyo, Tokyo, 113-0032, Japan (e-mail: hiroe@eri.u-tokyo.ac.jp).
"""
    assert (
        source_dedupe.extract_paper_title_from_markdown(markdown)
        == "Long-Context Language Models with Retrieval for Multi-Document Reasoning"
    )


@pytest.mark.asyncio
async def test_analyze_notebook_duplicates_groups_by_normalized_title(monkeypatch):
    async def fake_repo_query(query, vars=None):
        return [
            {
                "id": "source:1",
                "title": "Large Language Models: A Review",
                "created": "2026-04-10 10:00:00",
                "updated": "2026-04-10 11:00:00",
            },
            {
                "id": "source:2",
                "title": "large language models a review",
                "created": "2026-04-09 10:00:00",
                "updated": "2026-04-09 11:00:00",
            },
            {
                "id": "source:3",
                "title": "Another Paper",
                "created": "2026-04-08 10:00:00",
                "updated": "2026-04-08 11:00:00",
            },
        ]

    monkeypatch.setattr(source_dedupe, "repo_query", fake_repo_query)

    result = await source_dedupe.analyze_notebook_duplicates("notebook:test")
    assert len(result) == 1
    assert result[0]["keep_source_id"] == "source:1"
    assert result[0]["duplicate_count"] == 1
    assert result[0]["duplicates"][0]["source_id"] == "source:2"


@pytest.mark.asyncio
async def test_analyze_notebook_duplicates_groups_by_extracted_full_text_title(monkeypatch):
    async def fake_repo_query(query, vars=None):
        return [
            {
                "id": "source:1",
                "title": "Tool-Augmented Language Models for Reliable Multi-Step Agents",
                "full_text": "",
                "asset": None,
                "created": "2026-04-11 11:44:00",
                "updated": "2026-04-11 11:44:33",
            },
            {
                "id": "source:2",
                "title": "tool_use_agents.md",
                "full_text": "# Tool-Augmented Language Models for Reliable Multi-Step Agents\n\nBody",
                "asset": {"file_path": "data/uploads/tool_use_agents.md"},
                "created": "2026-03-03 16:08:36",
                "updated": "2026-03-03 16:08:37",
            },
            {
                "id": "source:3",
                "title": "Tool-Augmented_Language_Models_for_Reliable_Multi-Step_Agents (1).md",
                "full_text": "# Tool-Augmented Language Models for Reliable Multi-Step Agents\n\nBody",
                "asset": {"file_path": "data/uploads/Tool-Augmented_Language_Models_for_Reliable_Multi-Step_Agents (1).md"},
                "created": "2026-03-04 02:19:09",
                "updated": "2026-03-04 02:19:09",
            },
        ]

    monkeypatch.setattr(source_dedupe, "repo_query", fake_repo_query)

    result = await source_dedupe.analyze_notebook_duplicates("notebook:test")
    assert len(result) == 1
    assert result[0]["keep_source_id"] == "source:1"
    assert result[0]["duplicate_count"] == 2
    assert {item["source_id"] for item in result[0]["duplicates"]} == {"source:2", "source:3"}
