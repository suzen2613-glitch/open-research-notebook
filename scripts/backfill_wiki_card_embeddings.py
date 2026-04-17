"""Backfill card_embedding for existing SourceWikiCard records.

Run with:
    uv run --env-file .env python scripts/backfill_wiki_card_embeddings.py

Skips cards that already have an embedding. Safe to re-run.
"""
import asyncio
import sys

from loguru import logger

from open_notebook.ai.models import model_manager
from open_notebook.domain.notebook import SourceWikiCard
from open_notebook.services.source_wiki_card import (
    generate_card_embedding,
    serialize_source_wiki_card,
)


async def main() -> int:
    if not await model_manager.get_embedding_model():
        logger.error(
            "No embedding model configured. Set one in the Models settings and retry."
        )
        return 1

    wiki_cards = await SourceWikiCard.get_all(order_by="updated DESC")
    logger.info(f"Found {len(wiki_cards)} wiki cards")

    processed = 0
    skipped = 0
    failed = 0

    for wiki_card in wiki_cards:
        if wiki_card.embedding:
            skipped += 1
            continue

        try:
            serialized = await serialize_source_wiki_card(wiki_card)
            embedding = await generate_card_embedding(serialized)
            if not embedding:
                logger.warning(
                    f"No embedding produced for card {wiki_card.id}; skipping"
                )
                failed += 1
                continue

            wiki_card.embedding = embedding
            await wiki_card.save()
            processed += 1
            if processed % 10 == 0:
                logger.info(
                    f"Progress: processed={processed} skipped={skipped} failed={failed}"
                )
        except Exception as exc:
            logger.exception(f"Failed to backfill embedding for {wiki_card.id}: {exc}")
            failed += 1

    logger.info(
        f"Done. processed={processed} skipped={skipped} failed={failed} "
        f"total={len(wiki_cards)}"
    )
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
