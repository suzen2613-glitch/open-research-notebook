import pytest

from open_notebook.services import source_dedupe


def test_extract_paper_title_from_markdown_prefers_real_heading_over_metadata():
    markdown = """# Wu et al. - 2023 - A comprehensive study of non-adaptive and residual-based adaptive sampling for physics-informed neur

- Zotero Collection: Test
- Zotero Item Key: ABC
- Zotero Attachment Key: XYZ

<!-- zotero:item_key=ABC;attachment_key=XYZ;collection_id=1 -->

# A Comprehensive Study of Non-Adaptive and Residual-Based Adaptive Sampling for Physics-Informed Neural Networks

Author One, Author Two

## Abstract
Body
"""
    assert (
        source_dedupe.extract_paper_title_from_markdown(markdown)
        == "A Comprehensive Study of Non-Adaptive and Residual-Based Adaptive Sampling for Physics-Informed Neural Networks"
    )


def test_normalize_paper_title_handles_spacing_and_punctuation():
    title_a = "Physics-Informed Neural Networks: A Review"
    title_b = "physics informed neural networks a review"
    assert source_dedupe.normalize_paper_title(title_a) == source_dedupe.normalize_paper_title(title_b)


def test_cleanup_filename_title_strips_export_artifacts():
    cleaned = source_dedupe.cleanup_filename_title(
        "JGR Solid Earth - 2022 - Rasht‐Behesht - Physics‐Informed Neural Networks  PINNs  for Wave Propagation and Full Waveform.md"
    )
    assert cleaned == "Physics‐Informed Neural Networks PINNs for Wave Propagation and Full Waveform"


def test_get_effective_source_title_prefers_full_text_heading():
    source_like = {
        "title": "SAS_pinn.md",
        "full_text": "# SAS-PINN: An Enhanced Physics-Informed Neural Network for 2-D Time-Domain Electromagnetic Field Computation of Power Transformer\n\nBody",
    }
    assert (
        source_dedupe.get_effective_source_title(source_like)
        == "SAS-PINN: An Enhanced Physics-Informed Neural Network for 2-D Time-Domain Electromagnetic Field Computation of Power Transformer"
    )


def test_extract_paper_title_ignores_venue_headers_and_online_headers():
    markdown = """Available online at www.sciencedirect.com

Journal of Computational Physics

# A Comprehensive Study of Non-Adaptive and Residual-Based Adaptive Sampling for Physics-Informed Neural Networks

Abstract
"""
    assert (
        source_dedupe.extract_paper_title_from_markdown(markdown)
        == "A Comprehensive Study of Non-Adaptive and Residual-Based Adaptive Sampling for Physics-Informed Neural Networks"
    )


def test_extract_paper_title_ignores_keywords_line_when_heading_exists():
    markdown = """# A comprehensive study of non-adaptive and residual-based adaptive sampling for physics-informed neural networks

Keywords: Partial differential equations; Physics-informed neural networks; Residual-based adaptive sampling
"""
    assert (
        source_dedupe.extract_paper_title_from_markdown(markdown)
        == "A comprehensive study of non-adaptive and residual-based adaptive sampling for physics-informed neural networks"
    )


def test_extract_paper_title_ignores_affiliation_line_when_heading_exists():
    markdown = """# Physics-informed Neural Networks with Fourier Features for Seismic Wavefield Simulation in Time-Domain Nonsmooth Complex Media

Hiroe Miyake is with the Earthquake Research Institute, The University of Tokyo, Tokyo, 113-0032, Japan (e-mail: hiroe@eri.u-tokyo.ac.jp).
"""
    assert (
        source_dedupe.extract_paper_title_from_markdown(markdown)
        == "Physics-informed Neural Networks with Fourier Features for Seismic Wavefield Simulation in Time-Domain Nonsmooth Complex Media"
    )


def test_extract_paper_title_ignores_numbered_section_heading_before_true_title():
    markdown = """# 3.1 Encoder and Decoder Stacks

- Zotero Collection: LLM

# Attention Is All You Need

Ashish Vaswani, Noam Shazeer, Niki Parmar
"""
    assert (
        source_dedupe.extract_paper_title_from_markdown(markdown)
        == "Attention Is All You Need"
    )


def test_extract_paper_title_ignores_numbered_heading_with_subsection_prefix():
    markdown = """# 3.1. Approach 1: Fix model sizes and vary number of training tokens

- Zotero Collection: LLM

# Training Compute-Optimal Large Language Models

Jordan Hoffmann, Sebastian Borgeaud
"""
    assert (
        source_dedupe.extract_paper_title_from_markdown(markdown)
        == "Training Compute-Optimal Large Language Models"
    )


@pytest.mark.asyncio
async def test_analyze_notebook_duplicates_groups_by_normalized_title(monkeypatch):
    async def fake_repo_query(query, vars=None):
        return [
            {
                "id": "source:1",
                "title": "Physics-Informed Neural Networks: A Review",
                "created": "2026-04-10 10:00:00",
                "updated": "2026-04-10 11:00:00",
            },
            {
                "id": "source:2",
                "title": "physics informed neural networks a review",
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
                "title": "SAS-PINN: An Enhanced Physics-Informed Neural Network for 2-D Time-Domain Electromagnetic Field Computation of Power Transformer",
                "full_text": "",
                "asset": None,
                "created": "2026-04-11 11:44:00",
                "updated": "2026-04-11 11:44:33",
            },
            {
                "id": "source:2",
                "title": "SAS_pinn.md",
                "full_text": "# SAS-PINN: An Enhanced Physics-Informed Neural Network for 2-D Time-Domain Electromagnetic Field Computation of Power Transformer\n\nBody",
                "asset": {"file_path": "data/uploads/SAS_pinn.md"},
                "created": "2026-03-03 16:08:36",
                "updated": "2026-03-03 16:08:37",
            },
            {
                "id": "source:3",
                "title": "SAS-PINN_An_Enhanced_Physics-Informed_Neural_Network_for_2-D_Time-Domain_Electromagnetic_Field_Computation_of_Power_Transformer (1).md",
                "full_text": "# SAS-PINN: An Enhanced Physics-Informed Neural Network for 2-D Time-Domain Electromagnetic Field Computation of Power Transformer\n\nBody",
                "asset": {"file_path": "data/uploads/SAS-PINN_An_Enhanced_Physics-Informed_Neural_Network_for_2-D_Time-Domain_Electromagnetic_Field_Computation_of_Power_Transformer (1).md"},
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


@pytest.mark.asyncio
async def test_cleanup_notebook_duplicates_unlinks_shared_sources_with_correct_direction(
    monkeypatch,
):
    issued_queries = []

    async def fake_analyze_notebook_duplicates(notebook_id):
        return [
            {
                "normalized_title": "attention is all you need",
                "keep_source_id": "source:keep",
                "keep_title": "Attention Is All You Need",
                "duplicate_count": 1,
                "duplicates": [
                    {
                        "source_id": "source:dup",
                        "title": "Attention Is All You Need",
                        "created": "2026-04-13 10:00:00",
                        "updated": "2026-04-13 10:00:00",
                    }
                ],
            }
        ]

    class FakeSource:
        async def get_notebook_ids(self):
            return ["notebook:test", "notebook:other"]

    async def fake_repo_query(query, vars=None):
        issued_queries.append((query, vars))
        return []

    monkeypatch.setattr(
        source_dedupe, "analyze_notebook_duplicates", fake_analyze_notebook_duplicates
    )
    async def fake_source_get(source_id):
        return FakeSource()

    monkeypatch.setattr(source_dedupe.Source, "get", fake_source_get)
    monkeypatch.setattr(source_dedupe, "repo_query", fake_repo_query)
    monkeypatch.setattr(source_dedupe, "ensure_record_id", lambda value: value)

    result = await source_dedupe.cleanup_notebook_duplicates("notebook:test")

    assert result["removed_count"] == 0
    assert result["unlinked_count"] == 1
    assert issued_queries == [
        (
            "DELETE reference WHERE in = $source_id AND out = $notebook_id",
            {"source_id": "source:dup", "notebook_id": "notebook:test"},
        )
    ]


@pytest.mark.asyncio
async def test_find_source_by_normalized_title_requires_notebook_membership_and_respects_exclusion(
    monkeypatch,
):
    async def fake_repo_query(query, vars=None):
        return [
            {
                "id": "source:self",
                "title": "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
                "full_text": None,
                "asset": None,
                "notebook_ids": ["notebook:llm"],
            },
            {
                "id": "source:unlinked",
                "title": "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
                "full_text": None,
                "asset": None,
                "notebook_ids": [],
            },
            {
                "id": "source:other",
                "title": "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
                "full_text": None,
                "asset": None,
                "notebook_ids": ["notebook:other"],
            },
        ]

    monkeypatch.setattr(source_dedupe, "repo_query", fake_repo_query)

    normalized = source_dedupe.normalize_paper_title(
        "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"
    )
    result = await source_dedupe.find_source_by_normalized_title(
        normalized,
        notebook_id="notebook:llm",
        exclude_source_id="source:self",
    )

    assert result is None
