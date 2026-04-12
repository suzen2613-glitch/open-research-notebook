import asyncio

from open_notebook.domain.notebook import Source, SourceEmbedding, SourceWikiCard
from open_notebook.services.source_wiki_card import (
    _choose_canonical_name,
    enrich_wiki_card_quality_fields,
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
                "LLMs",
                "Large Language Models",
                "Untitled Source",
            ],
            "methods": ["Large language model"],
            "problems": [
                "Untitled Source",
                "Tool-calling reliability",
                "Not stated in the source",
            ],
            "contributions": ["Improves tool-calling reliability"],
            "limitations": [],
            "paper_type": "survey",
            "domains": [
                "llm",
                "agents",
                "evaluation",
                "ai_infra",
            ],
            "keywords": ["LLM", "Tool Use"],
            "core_concepts": ["LLM", "Tool Use"],
            "moc_groups": ["LLM - Method Improvements"],
            "recommended_entry_points": [
                "concept:llm",
                "concept:tool_use",
                "concept:tool-use",
                "domain:llm",
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

    assert normalized["concept_ids"] == ["concept:llm"]
    assert normalized["concept_names"] == ["LLM"]
    assert normalized["question_ids"] == ["question:tool-calling-reliability"]
    assert normalized["question_names"] == ["Tool-calling reliability"]
    assert normalized["paper_type"] == "review"
    assert normalized["domains"] == [
        "llm",
        "agents",
        "evaluation",
    ]
    assert normalized["core_concept_ids"] == ["concept:llm"]
    assert normalized["recommended_entry_points"] == [
        "concept:llm",
        "concept:tool-use",
        "domain:llm",
        "domain:agents",
        "domain:evaluation",
    ]
    assert normalized["moc_groups"] == [
        "LLM - Reviews",
        "LLM - AI Systems",
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
        short_title="Tool Use for LLMs",
        canonical_title="Sample Paper",
        slug="sample-paper",
        paper_type="method",
        domains=["agents"],
        topics=["LLMs"],
        methods=["Function Calling"],
        problems=["Untitled Source", "Tool selection errors"],
        keywords=["LLM", "Tool Use"],
        moc_groups=["LLM - Method"],
        recommended_entry_points=["concept:llm", "domain:agents"],
        is_key_paper=True,
        core_concept_ids=["concept:llm"],
        status="completed",
        extraction_confidence=0.74,
        evidence_snippets=[
            {
                "embedding_id": "source_embedding:test",
                "excerpt": "Evidence excerpt",
                "reason": "Matches: LLM",
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

    assert serialized["concept_ids"] == [
        "concept:llm",
        "concept:function-calling",
    ]
    assert serialized["concept_names"] == [
        "LLM",
        "Function Calling",
    ]
    assert serialized["short_title"] == "Tool Use for LLMs"
    assert serialized["paper_type"] == "method"
    assert serialized["domains"] == ["agents"]
    assert serialized["core_concept_ids"] == ["concept:llm", "concept:function-calling"]
    assert serialized["is_key_paper"] is True
    assert serialized["question_ids"] == ["question:tool-selection-errors"]
    assert serialized["question_names"] == ["Tool selection errors"]
    assert serialized["obsidian_frontmatter"]["wiki_card_id"] == "source_wiki_card:test"
    assert serialized["obsidian_frontmatter"]["paper_type"] == "method"
    assert serialized["obsidian_frontmatter"]["domains"] == ["agents"]
    assert serialized["obsidian_frontmatter"]["question_names"] == [
        "Tool selection errors"
    ]
    assert 'wiki_card_id: "source_wiki_card:test"' in serialized["obsidian_markdown"]
    assert "question:untitled-source" not in serialized["question_ids"]


def test_short_title_core_concepts_and_entry_points_are_tightly_normalized():
    source = Source(
        id="source:test",
        title="A Very Long and Descriptive Title for Tool-Using Language Models with Retrieval and Planning",
    )

    normalized = normalize_wiki_card_payload(
        payload={
            "title": source.title,
            "short_title": "An Extremely Long Short Title That Should Be Clipped Down For Navigation",
            "authors": ["Alice"],
            "topics": [
                "LLM",
                "Tool Use",
                "Retrieval",
                "Planning",
                "Long Context",
                "Agent Memory",
            ],
            "methods": ["Function Calling", "RAG", "Planning"],
            "problems": ["Hallucination control"],
            "contributions": ["Improves grounding"],
            "limitations": [],
            "paper_type": "method",
            "domains": ["llm"],
            "keywords": [],
            "core_concepts": ["LLM", "Tool Use", "Retrieval", "Planning", "Long Context"],
            "moc_groups": ["Totally Freeform Group"],
            "recommended_entry_points": [
                "concept:tool_use",
                "concept:tool-use",
                "domain:llm",
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
        "concept:llm",
        "concept:tool-use",
        "concept:retrieval",
        "concept:planning",
    ]
    assert normalized["recommended_entry_points"] == [
        "concept:tool-use",
        "domain:llm",
        "concept:llm",
        "concept:retrieval",
        "concept:planning",
    ]
    assert normalized["moc_groups"] == [
        "LLM - Methods",
        "LLM - AI Systems",
    ]


def test_moc_groups_use_stable_navigation_hubs_instead_of_paper_level_topics():
    source = Source(
        id="source:test",
        title="Building LLM Agents with Tool Use",
    )

    normalized = normalize_wiki_card_payload(
        payload={
            "title": source.title,
            "authors": ["Alice"],
            "topics": ["Tool Use", "Code Assistants", "LLMs"],
            "methods": ["Planning"],
            "problems": ["Tool routing"],
            "contributions": ["Improves reliability"],
            "limitations": [],
            "paper_type": "method",
            "domains": ["agents", "code_generation"],
            "keywords": [],
            "core_concepts": ["Tool Use", "LLM"],
            "moc_groups": [
                "Tool Use - Methods",
                "Code Assistants - Agents",
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
        "LLM - Methods",
        "LLM - AI Systems",
    ]
    assert all("Tool Use - Methods" not in group for group in normalized["moc_groups"])
    assert all("Code Assistants" not in group for group in normalized["moc_groups"])


def test_serialize_source_wiki_card_prefers_canonical_registry_aliases():
    wiki_card = SourceWikiCard(
        id="source_wiki_card:test",
        source="source:test",
        notebook_ids=["notebook:test"],
        title="Sample Paper",
        canonical_title="Sample Paper",
        slug="sample-paper",
        topics=["Large Language Models"],
        methods=["Tool Routing"],
        problems=["LLM tool reliability"],
        concept_ids=["concept:large-language-models", "concept:tool-routing"],
        concept_names=["Large Language Models", "Tool Routing"],
        question_ids=["question:llm-tool-reliability"],
        question_names=["LLM tool reliability"],
        extraction_confidence=0.82,
        evidence_snippets=[
            {
                "embedding_id": "source_embedding:test",
                "excerpt": "Evidence excerpt",
                "reason": "Matches: LLM tool reliability",
            }
        ],
        status="completed",
    )

    serialized = asyncio.run(
        serialize_source_wiki_card(
            wiki_card,
            concept_lookup={
                "large language models": ("concept:llm", "LLM"),
                "tool routing": ("concept:tool-routing", "Tool Routing"),
            },
            question_lookup={
                "llm tool reliability": ("question:tool-reliability", "Tool Reliability")
            },
        )
    )

    assert serialized["concept_ids"] == ["concept:llm", "concept:tool-routing"]
    assert serialized["concept_names"] == ["LLM", "Tool Routing"]
    assert serialized["question_ids"] == ["question:tool-reliability"]
    assert serialized["question_names"] == ["Tool Reliability"]
    assert serialized["obsidian_frontmatter"]["concept_ids"] == [
        "concept:llm",
        "concept:tool-routing",
    ]


def test_choose_canonical_name_prefers_english_alias_for_bilingual_registry():
    canonical_name, canonical_language = _choose_canonical_name(
        "大语言模型",
        [
            "大语言模型",
            "Large Language Models",
            "LLM",
        ],
    )

    assert canonical_name == "LLM"
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
                        "Large language models use retrieval and tool routing "
                        "to reduce hallucinations in multi-step workflows."
                    ),
                )
            ]

    enriched = asyncio.run(
        enrich_wiki_card_quality_fields(
            {
                "title": "大语言模型论文",
                "canonical_title": "Large Language Model Paper",
                "summary_text": "研究 LLM 的检索与工具调用策略。",
                "topics": ["大语言模型"],
                "methods": ["检索增强生成"],
                "problems": ["多步推理中的幻觉"],
                "contributions": ["Improves LLM grounding."],
                "limitations": [],
                "concept_names": ["LLM"],
                "question_names": ["Hallucination control"],
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
    assert "Large Language Model Paper" in enriched["evidence_snippets"][0]["reason"]
