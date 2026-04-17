from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from commands import source_commands


class _FakeWikiCard:
    def __init__(self):
        self.notebook_ids = []
        self.source_title = None
        self.title = None
        self.short_title = None
        self.canonical_title = None
        self.slug = None
        self.authors = []
        self.year = None
        self.venue = None
        self.paper_type = None
        self.domains = []
        self.summary_text = None
        self.research_context = None
        self.claimed_gap = None
        self.positioning_summary = None
        self.topics = []
        self.methods = []
        self.problems = []
        self.contributions = []
        self.limitations = []
        self.keywords = []
        self.moc_groups = []
        self.recommended_entry_points = []
        self.is_key_paper = False
        self.concept_ids = []
        self.concept_names = []
        self.core_concept_ids = []
        self.question_ids = []
        self.question_names = []
        self.related_sources = []
        self.relation_edges = []
        self.display_language = None
        self.canonical_language = None
        self.extraction_confidence = None
        self.evidence_snippets = []
        self.summary_source_insight_id = None
        self.prompt_snapshot = None
        self.model_id = None
        self.command_id = None
        self.status = None
        self.error_message = None
        self.obsidian_markdown = None
        self.obsidian_frontmatter = None
        self.save_calls = 0

    async def save(self):
        self.save_calls += 1


@pytest.mark.asyncio
async def test_generate_wiki_card_command_persists_intro_context_fields(monkeypatch):
    fake_source = SimpleNamespace(id="source:test", title="Test Source")
    fake_wiki_card = _FakeWikiCard()

    payload = {
        "notebook_ids": ["notebook:test"],
        "source_title": "Test Source",
        "title": "Test Source",
        "short_title": "Test Source",
        "canonical_title": "Test Source",
        "slug": "test-source",
        "authors": ["Alice"],
        "year": 2024,
        "venue": "TestConf",
        "paper_type": "method",
        "domains": ["scientific_ml"],
        "summary_text": "Summary",
        "research_context": "Background and research context.",
        "claimed_gap": "Prior work misses a practical systems gap.",
        "positioning_summary": "This paper positions itself as a practical improvement.",
        "topics": ["Topic"],
        "methods": ["Method"],
        "problems": ["Problem"],
        "contributions": ["Contribution"],
        "limitations": ["Limitation"],
        "keywords": ["Keyword"],
        "moc_groups": ["Scientific ML - Methods"],
        "recommended_entry_points": ["concept:topic"],
        "is_key_paper": True,
        "concept_ids": ["concept:topic"],
        "concept_names": ["Topic"],
        "core_concept_ids": ["concept:topic"],
        "question_ids": ["question:problem"],
        "question_names": ["Problem"],
        "related_sources": [],
        "relation_edges": [],
        "display_language": "en",
        "canonical_language": "en",
        "extraction_confidence": 0.91,
        "evidence_snippets": [],
        "summary_source_insight_id": None,
        "prompt_snapshot": "prompt",
        "model_id": "model:test",
    }

    monkeypatch.setattr(source_commands.Source, "get", AsyncMock(return_value=fake_source))
    monkeypatch.setattr(source_commands.SourceWikiCard, "get", AsyncMock(return_value=fake_wiki_card))
    monkeypatch.setattr(source_commands, "generate_wiki_card_payload", AsyncMock(return_value=payload))
    monkeypatch.setattr(
        source_commands,
        "serialize_source_wiki_card",
        AsyncMock(return_value={"obsidian_markdown": "md", "obsidian_frontmatter": {"title": "Test Source"}}),
    )
    sync_mock = AsyncMock()
    monkeypatch.setattr(source_commands, "sync_wiki_card_knowledge_registry", sync_mock)

    input_data = source_commands.GenerateWikiCardInput(
        source_id="source:test",
        wiki_card_id="source_wiki_card:test",
    )

    result = await source_commands.generate_wiki_card_command(input_data)

    assert result.success is True
    assert fake_wiki_card.research_context == payload["research_context"]
    assert fake_wiki_card.claimed_gap == payload["claimed_gap"]
    assert fake_wiki_card.positioning_summary == payload["positioning_summary"]
    assert fake_wiki_card.status == "completed"
    assert fake_wiki_card.obsidian_markdown == "md"
    assert fake_wiki_card.save_calls == 1
    sync_mock.assert_awaited_once()
