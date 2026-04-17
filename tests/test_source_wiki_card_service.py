import asyncio

from open_notebook.domain.notebook import Source, SourceEmbedding, SourceWikiCard
from open_notebook.services.source_wiki_card import (
    _choose_canonical_name,
    _extract_intro_context_fallback,
    _extract_intro_context_object,
    _fill_missing_intro_context_fields,
    _merge_intro_context_fields,
    enrich_wiki_card_quality_fields,
    extract_context_sections,
    normalize_wiki_card_payload,
    serialize_source_wiki_card,
)


def test_normalize_wiki_card_payload_filters_placeholders_and_merges_aliases():
    source = Source(id="source:test", title="Sample Paper")

    normalized = normalize_wiki_card_payload(
        payload={
            "title": "Sample Paper",
            "authors": ["Alice", "Bob"],
            "topics": [
                "PINNs",
                "Physics-Informed Neural Networks",
                "Untitled Source",
            ],
            "methods": ["Physics informed neural network"],
            "problems": [
                "Untitled Source",
                "Convergence issues",
                "Not stated in the source",
            ],
            "contributions": ["Improves convergence"],
            "limitations": [],
            "paper_type": "survey",
            "domains": [
                "electromagnetics",
                "inverse problem",
                "wave propagation",
                "scientific_ml",
            ],
            "keywords": ["PINN", "Adaptive Sampling"],
            "core_concepts": ["PINN", "Adaptive Sampling"],
            "moc_groups": ["PINN - Method Improvements"],
            "recommended_entry_points": [
                "concept:pinn",
                "concept:pinn_optimization",
                "concept:pinn-optimization",
                "domain:electromagnetics",
            ],
            "is_key_paper": True,
            "related_sources": [],
        },
        source=source,
        notebook_ids=["notebook:test"],
        summary_record=None,
        related_source_candidates=[],
        model_id="model:test",
        prompt_snapshot="prompt",
    )

    assert normalized["concept_ids"] == ["concept:pinn"]
    assert normalized["concept_names"] == ["PINN"]
    assert normalized["question_ids"] == ["question:convergence-issues"]
    assert normalized["question_names"] == ["Convergence issues"]
    assert normalized["paper_type"] == "review"
    assert normalized["domains"] == [
        "electromagnetics",
        "inverse_problem",
        "wave_propagation",
    ]
    assert normalized["core_concept_ids"] == ["concept:pinn"]
    assert normalized["recommended_entry_points"] == [
        "concept:pinn",
        "concept:pinn-optimization",
        "domain:electromagnetics",
        "domain:inverse-problem",
        "domain:wave-propagation",
    ]
    assert normalized["moc_groups"] == [
        "PINN - Reviews",
        "PINN - Scientific ML",
    ]
    assert normalized["is_key_paper"] is True
    assert "concept:untitled-source" not in normalized["concept_ids"]
    assert "question:untitled-source" not in normalized["question_ids"]


def test_serialize_source_wiki_card_regenerates_frontmatter_and_question_names():
    wiki_card = SourceWikiCard(
        id="source_wiki_card:test",
        source="source:test",
        notebook_ids=["notebook:test"],
        title="Sample Paper",
        short_title="Adaptive Sampling for PINNs",
        canonical_title="Sample Paper",
        slug="sample-paper",
        paper_type="method",
        domains=["wave_propagation"],
        topics=["PINNs"],
        methods=["Physics-Informed Neural Networks"],
        problems=["Untitled Source", "High-frequency learning"],
        keywords=["PINN", "Adaptive Sampling"],
        moc_groups=["PINN - Method"],
        recommended_entry_points=["concept:pinn", "domain:wave_propagation"],
        is_key_paper=True,
        core_concept_ids=["concept:pinn"],
        status="completed",
        extraction_confidence=0.74,
        evidence_snippets=[
            {
                "embedding_id": "source_embedding:test",
                "excerpt": "Evidence excerpt",
                "reason": "Matches: PINN",
            }
        ],
        obsidian_frontmatter={"wiki_card_id": None},
        obsidian_markdown="stale",
    )

    serialized = asyncio.run(
        serialize_source_wiki_card(
            wiki_card,
            concept_lookup={},
            question_lookup={},
        )
    )

    assert serialized["concept_ids"] == ["concept:pinn"]
    assert serialized["concept_names"] == ["PINN"]
    assert serialized["short_title"] == "Adaptive Sampling for PINNs"
    assert serialized["paper_type"] == "method"
    assert serialized["domains"] == ["wave_propagation"]
    assert serialized["core_concept_ids"] == ["concept:pinn"]
    assert serialized["is_key_paper"] is True
    assert serialized["question_ids"] == ["question:high-frequency-learning"]
    assert serialized["question_names"] == ["High-frequency learning"]
    assert serialized["obsidian_frontmatter"]["wiki_card_id"] == "source_wiki_card:test"
    assert serialized["obsidian_frontmatter"]["paper_type"] == "method"
    assert serialized["obsidian_frontmatter"]["domains"] == ["wave_propagation"]
    assert serialized["obsidian_frontmatter"]["question_names"] == [
        "High-frequency learning"
    ]
    assert 'wiki_card_id: "source_wiki_card:test"' in serialized["obsidian_markdown"]
    assert "question:untitled-source" not in serialized["question_ids"]


def test_short_title_core_concepts_and_entry_points_are_tightly_normalized():
    source = Source(
        id="source:test",
        title="A Very Long and Descriptive Title for Adaptive Sampling Methods in Physics-Informed Neural Networks",
    )

    normalized = normalize_wiki_card_payload(
        payload={
            "title": source.title,
            "short_title": "An Extremely Long Short Title That Should Be Clipped Down For Navigation",
            "authors": ["Alice"],
            "topics": [
                "PINN",
                "Adaptive Sampling",
                "Fourier Features",
                "Residual Points",
                "Spectral Bias",
                "Inverse Problems",
            ],
            "methods": ["RAR-D", "RAD", "Loss Reweighting"],
            "problems": ["Convergence issues"],
            "contributions": ["Improves convergence"],
            "limitations": [],
            "paper_type": "method",
            "domains": ["scientific_ml"],
            "keywords": [],
            "core_concepts": ["PINN", "Adaptive Sampling", "Fourier Features", "Residual Points", "Spectral Bias"],
            "moc_groups": ["Totally Freeform Group"],
            "recommended_entry_points": [
                "concept:pinn_optimization",
                "concept:pinn-optimization",
                "domain:scientific ml",
            ],
            "is_key_paper": False,
            "related_sources": [],
        },
        source=source,
        notebook_ids=["notebook:test"],
        summary_record=None,
        related_source_candidates=[],
        model_id="model:test",
        prompt_snapshot="prompt",
    )

    assert len(normalized["short_title"].split()) <= 8
    assert normalized["core_concept_ids"] == [
        "concept:pinn",
        "concept:adaptive-sampling",
        "concept:fourier-features",
        "concept:residual-points",
    ]
    assert normalized["recommended_entry_points"] == [
        "concept:pinn-optimization",
        "domain:scientific-ml",
        "concept:pinn",
        "concept:adaptive-sampling",
        "concept:fourier-features",
        "concept:residual-points",
    ]
    assert normalized["moc_groups"] == [
        "PINN - Methods",
        "PINN - Scientific ML",
    ]


def test_moc_groups_use_stable_navigation_hubs_instead_of_paper_level_topics():
    source = Source(
        id="source:test",
        title="Acoustic Wavefields with PINNs",
    )

    normalized = normalize_wiki_card_payload(
        payload={
            "title": source.title,
            "authors": ["Alice"],
            "topics": ["Acoustic Wavefields", "Power Transformer", "PINNs"],
            "methods": ["Adaptive Sampling"],
            "problems": ["Inverse scattering"],
            "contributions": ["Improves convergence"],
            "limitations": [],
            "paper_type": "method",
            "domains": ["electromagnetics", "wave_propagation"],
            "keywords": [],
            "core_concepts": ["Acoustic Wavefields", "PINN"],
            "moc_groups": [
                "Acoustic Wavefields - Methods",
                "Power Transformer - Electromagnetics",
            ],
            "recommended_entry_points": [],
            "is_key_paper": False,
            "related_sources": [],
        },
        source=source,
        notebook_ids=["notebook:test"],
        summary_record=None,
        related_source_candidates=[],
        model_id="model:test",
        prompt_snapshot="prompt",
    )

    assert normalized["moc_groups"] == [
        "PINN - Methods",
        "PINN - Scientific ML",
    ]
    assert all("Acoustic Wavefields" not in group for group in normalized["moc_groups"])
    assert all("Power Transformer" not in group for group in normalized["moc_groups"])


def test_serialize_source_wiki_card_prefers_canonical_registry_aliases():
    wiki_card = SourceWikiCard(
        id="source_wiki_card:test",
        source="source:test",
        notebook_ids=["notebook:test"],
        title="Sample Paper",
        canonical_title="Sample Paper",
        slug="sample-paper",
        topics=["Physics-Informed Neural Networks"],
        methods=["RAR-D"],
        problems=["PINN convergence"],
        concept_ids=["concept:physics-informed-neural-networks", "concept:rar-d"],
        concept_names=["Physics-Informed Neural Networks", "RAR-D"],
        question_ids=["question:pinn-convergence"],
        question_names=["PINN convergence"],
        extraction_confidence=0.82,
        evidence_snippets=[
            {
                "embedding_id": "source_embedding:test",
                "excerpt": "Evidence excerpt",
                "reason": "Matches: PINN convergence",
            }
        ],
        status="completed",
    )

    serialized = asyncio.run(
        serialize_source_wiki_card(
            wiki_card,
            concept_lookup={
                "physics informed neural networks": ("concept:pinn", "PINN"),
                "rar d": ("concept:rar-d", "RAR-D"),
            },
            question_lookup={
                "pinn convergence": ("question:convergence-issues", "Convergence issues")
            },
        )
    )

    assert serialized["concept_ids"] == ["concept:pinn", "concept:rar-d"]
    assert serialized["concept_names"] == ["PINN", "RAR-D"]
    assert serialized["question_ids"] == ["question:convergence-issues"]
    assert serialized["question_names"] == ["Convergence issues"]
    assert serialized["obsidian_frontmatter"]["concept_ids"] == [
        "concept:pinn",
        "concept:rar-d",
    ]


def test_choose_canonical_name_prefers_english_alias_for_bilingual_registry():
    canonical_name, canonical_language = _choose_canonical_name(
        "物理信息神经网络",
        [
            "物理信息神经网络",
            "Physics-Informed Neural Networks",
            "PINN",
        ],
    )

    assert canonical_name == "PINN"
    assert canonical_language == "en"


def test_enrich_wiki_card_quality_fields_adds_language_and_evidence():
    class FakeSource:
        async def get_embeddings(self, limit: int = 24):
            return [
                SourceEmbedding(
                    id="source_embedding:test-1",
                    source="source:test",
                    order=0,
                    section="Method",
                    char_start=10,
                    char_end=140,
                    content=(
                        "Physics-Informed Neural Networks (PINNs) are trained with "
                        "residual-based adaptive sampling to reduce high-frequency errors."
                    ),
                )
            ]

    enriched = asyncio.run(
        enrich_wiki_card_quality_fields(
            {
                "title": "物理信息神经网络论文",
                "canonical_title": "Physics-Informed Neural Network Paper",
                "summary_text": "研究 PINN 的采样策略。",
                "topics": ["物理信息神经网络"],
                "methods": ["残差自适应采样"],
                "problems": ["高频学习困难"],
                "contributions": ["Improves PINN sampling."],
                "limitations": [],
                "concept_names": ["PINN"],
                "question_names": ["High-frequency learning"],
                "related_sources": [],
                "summary_source_insight_id": "source_insight:test",
            },
            source=FakeSource(),
        )
    )

    assert enriched["display_language"] == "mixed"
    assert enriched["canonical_language"] == "en"
    assert enriched["extraction_confidence"] is not None
    assert enriched["evidence_snippets"][0]["embedding_id"] == "source_embedding:test-1"
    assert "PINN" in enriched["evidence_snippets"][0]["reason"]


def test_intro_positioning_fields_are_preserved_and_exported():
    source = Source(id="source:test", title="Sample Paper")

    normalized = normalize_wiki_card_payload(
        payload={
            "title": "Sample Paper",
            "authors": ["Alice"],
            "paper_type": "method",
            "domains": ["scientific_ml"],
            "summary_text": "A concise structured summary.",
            "research_context": "This paper is situated in the recent wave of LLM-based retrieval systems.",
            "claimed_gap": "Existing work does not jointly optimize retrieval grounding and reasoning latency.",
            "positioning_summary": "The paper positions itself as a practical systems-oriented improvement over prior RAG pipelines.",
            "topics": ["RAG"],
            "methods": ["Latency-aware retrieval"],
            "problems": ["Reasoning latency"],
            "contributions": ["Improves latency"],
            "limitations": [],
            "keywords": ["RAG"],
            "core_concepts": ["RAG"],
            "moc_groups": [],
            "recommended_entry_points": [],
            "is_key_paper": False,
            "related_sources": [],
        },
        source=source,
        notebook_ids=["notebook:test"],
        summary_record=None,
        related_source_candidates=[],
        model_id="model:test",
        prompt_snapshot="prompt",
    )

    assert normalized["research_context"].startswith("This paper is situated")
    assert normalized["claimed_gap"].startswith("Existing work does not")
    assert normalized["positioning_summary"].startswith("The paper positions itself")
    assert normalized["obsidian_frontmatter"]["research_context"].startswith("This paper is situated")
    assert "## Research Context" in normalized["obsidian_markdown"]
    assert "## Claimed Gap" in normalized["obsidian_markdown"]
    assert "## Positioning" in normalized["obsidian_markdown"]


def test_extract_intro_context_object_accepts_intro_only_json():
    parsed = _extract_intro_context_object(
        '{"research_context": "Context", "claimed_gap": "Gap", "positioning_summary": "Positioning"}'
    )

    assert parsed == {
        "research_context": "Context",
        "claimed_gap": "Gap",
        "positioning_summary": "Positioning",
    }


def test_extract_context_sections_prefers_introduction_and_related_work_headings():
    full_text = """# Abstract
A short abstract.

# 1 Introduction
Transformers replace recurrence with attention.
The introduction states the research context clearly.

## Related Work
Prior sequence models rely on recurrent computation.

# Method
Model details live here.
"""

    sections = extract_context_sections(full_text)

    assert "Transformers replace recurrence with attention." in sections["introduction"]
    assert "Prior sequence models rely on recurrent computation." in sections["related_work"]
    assert "Model details live here." not in sections["introduction"]


def test_extract_intro_context_fallback_uses_introduction_signal_sentences():
    fallback = _extract_intro_context_fallback(
        context_sections={
            "introduction": """# 1 Introduction
Recurrent neural networks have become strong baselines for sequence transduction and machine translation tasks.
This inherently sequential design precludes parallelization within training examples and becomes a bottleneck on long sequences.
The fundamental constraint of sequential computation, however, remains even after factorization and conditional computation tricks.
In this work we propose the Transformer, a model architecture relying entirely on attention to model global dependencies.
""",
            "related_work": "",
        },
        summary_block="A compact summary.",
    )

    assert fallback["research_context"] is not None
    assert "Recurrent neural networks" in fallback["research_context"]
    assert fallback["claimed_gap"] is not None
    assert "sequential" in fallback["claimed_gap"].lower()
    assert fallback["positioning_summary"] is not None
    assert "we propose the Transformer" in fallback["positioning_summary"]


def test_fill_missing_intro_context_fields_prefers_model_output_and_backfills_empty_values():
    merged = _fill_missing_intro_context_fields(
        {
            "research_context": "Model supplied context.",
            "claimed_gap": None,
            "positioning_summary": "",
        },
        {
            "research_context": "Fallback context.",
            "claimed_gap": "Fallback gap.",
            "positioning_summary": "Fallback positioning.",
        },
    )

    assert merged == {
        "research_context": "Model supplied context.",
        "claimed_gap": "Fallback gap.",
        "positioning_summary": "Fallback positioning.",
    }


def test_merge_intro_context_fields_overrides_empty_main_payload_and_rerenders_exports():
    payload = {
        "title": "Sample Paper",
        "summary_text": "Short summary",
        "research_context": None,
        "claimed_gap": "",
        "positioning_summary": None,
        "obsidian_frontmatter": {
            "research_context": None,
            "claimed_gap": None,
            "positioning_summary": None,
        },
        "obsidian_markdown": "stale",
    }

    merged = _merge_intro_context_fields(
        payload,
        {
            "research_context": "The paper is positioned within the shift away from recurrent sequence models.",
            "claimed_gap": "Existing work still depends on sequential computation that limits parallelism.",
            "positioning_summary": "It presents attention-only sequence modeling as a simpler and more parallel alternative.",
        },
    )

    assert merged["research_context"].startswith("The paper is positioned")
    assert merged["claimed_gap"].startswith("Existing work still depends")
    assert merged["positioning_summary"].startswith("It presents attention-only")
    assert merged["obsidian_frontmatter"]["claimed_gap"].startswith("Existing work still depends")
    assert "## Research Context" in merged["obsidian_markdown"]
    assert "## Claimed Gap" in merged["obsidian_markdown"]
    assert "## Positioning" in merged["obsidian_markdown"]

