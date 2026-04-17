import asyncio

from open_notebook.domain.notebook import SourceWikiCard
from open_notebook.services.source_wiki_card import (
    get_concept_registry_lookup,
    get_question_registry_lookup,
    serialize_source_wiki_card,
    sync_wiki_card_knowledge_registry,
)


FIELDS_TO_SYNC = (
    "notebook_ids",
    "source_title",
    "title",
    "canonical_title",
    "slug",
    "authors",
    "year",
    "venue",
    "summary_text",
    "topics",
    "methods",
    "problems",
    "contributions",
    "limitations",
    "concept_ids",
    "concept_names",
    "question_ids",
    "question_names",
    "related_sources",
    "relation_edges",
    "display_language",
    "canonical_language",
    "extraction_confidence",
    "evidence_snippets",
    "obsidian_markdown",
    "obsidian_frontmatter",
)


async def main() -> None:
    concept_lookup = await get_concept_registry_lookup()
    question_lookup = await get_question_registry_lookup()
    wiki_cards = await SourceWikiCard.get_all(order_by="updated DESC")

    updated_cards = 0
    synced_registry = 0

    for wiki_card in wiki_cards:
        serialized = await serialize_source_wiki_card(
            wiki_card,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )

        changed = False
        for field_name in FIELDS_TO_SYNC:
            new_value = serialized.get(field_name)
            if getattr(wiki_card, field_name) != new_value:
                setattr(wiki_card, field_name, new_value)
                changed = True

        if changed:
            await wiki_card.save()
            updated_cards += 1

        await sync_wiki_card_knowledge_registry(serialized)
        synced_registry += 1

    print(
        f"Backfilled wiki knowledge registry for {synced_registry} wiki cards; "
        f"updated {updated_cards} stored cards."
    )


if __name__ == "__main__":
    asyncio.run(main())
