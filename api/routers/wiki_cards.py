from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from surreal_commands import submit_command

from api.models import (
    ConceptResponse,
    CreateSourceWikiCardRequest,
    NotebookMocLiteResponse,
    NotebookMocResponse,
    NotebookMocSectionResponse,
    QuestionResponse,
    RefreshWikiCardRequest,
    SourceRelationResponse,
    SourceWikiCardResponse,
    SourceWikiCardSlotResponse,
    WikiCardCreationResponse,
)
from api.command_service import CommandService
from open_notebook.database.repository import (
    ensure_record_id,
    normalize_record_id_string,
    repo_query,
)
from open_notebook.domain.notebook import (
    Concept,
    Notebook,
    Question,
    Source,
    SourceRelation,
    SourceWikiCard,
)
from open_notebook.services.source_wiki_card import (
    build_relation_entries,
    get_concept_registry_lookup,
    get_question_registry_lookup,
    serialize_source_wiki_card,
    upsert_pending_wiki_card,
)

router = APIRouter()


def _dedupe_strings(values: List[str]) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for value in values:
        normalized = str(value).strip()
        if not normalized:
            continue
        key = normalized.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


async def _get_registry_lookups() -> tuple[
    Dict[str, tuple[str, str]],
    Dict[str, tuple[str, str]],
]:
    return (
        await get_concept_registry_lookup(),
        await get_question_registry_lookup(),
    )


async def _fetch_notebook_wiki_card_rows(notebook_id: str) -> List[Dict[str, Any]]:
    return await repo_query(
        """
        SELECT id, title, created, updated,
            (
                SELECT *
                FROM source_wiki_card
                WHERE source = $parent.id
                ORDER BY updated DESC
                LIMIT 1
            )[0] AS wiki_card
        FROM (SELECT VALUE in FROM reference WHERE out = $notebook_id)
        ORDER BY updated DESC
        """,
        {"notebook_id": ensure_record_id(notebook_id)},
    )


async def _get_concept_registry_rows() -> List[Concept]:
    try:
        return await Concept.get_all(order_by="name")
    except Exception:
        return []


async def _get_question_registry_rows() -> List[Question]:
    try:
        return await Question.get_all(order_by="name")
    except Exception:
        return []


async def _serialize_relation_record(
    relation: SourceRelation,
) -> SourceRelationResponse:
    return SourceRelationResponse(
        id=str(relation.id or ""),
        source_id=str(relation.source_id),
        source_title=relation.source_title,
        target_source_id=str(relation.target_source_id),
        target_source_title=relation.target_source_title,
        relation_type=relation.relation_type,
        reason=relation.reason,
        notebook_ids=relation.notebook_ids,
        wiki_card_id=str(relation.wiki_card_id) if relation.wiki_card_id else None,
        created=str(relation.created or ""),
        updated=str(relation.updated or ""),
    )


def _serialize_relation_entry(
    relation: Dict[str, Any],
    *,
    created: str = "",
    updated: str = "",
) -> SourceRelationResponse:
    return SourceRelationResponse(
        id=str(relation.get("id") or ""),
        source_id=str(relation.get("source_id") or ""),
        source_title=relation.get("source_title"),
        target_source_id=str(relation.get("target_source_id") or ""),
        target_source_title=relation.get("target_source_title"),
        relation_type=str(relation.get("relation_type") or "related_work"),
        reason=str(relation.get("reason") or "No reason provided."),
        notebook_ids=[
            str(notebook_id)
            for notebook_id in relation.get("notebook_ids", [])
            if str(notebook_id).strip()
        ],
        wiki_card_id=str(relation.get("wiki_card_id") or "") or None,
        created=created,
        updated=updated,
    )


def _relation_list_contains_invalid_entries(value: object) -> bool:
    if not value:
        return False
    if not isinstance(value, list):
        return True

    for entry in value:
        if not isinstance(entry, dict):
            return True
        if not all(str(entry.get(field, "")).strip() for field in ("source_id", "relation_type", "reason")):
            return True
    return False


def _wiki_card_row_needs_cleanup(wiki_card_row: object) -> bool:
    if not isinstance(wiki_card_row, dict):
        return False

    if _relation_list_contains_invalid_entries(wiki_card_row.get("related_sources")):
        return True
    if _relation_list_contains_invalid_entries(wiki_card_row.get("relation_edges")):
        return True

    frontmatter = wiki_card_row.get("obsidian_frontmatter")
    if isinstance(frontmatter, dict) and _relation_list_contains_invalid_entries(
        frontmatter.get("relation_edges")
    ):
        return True

    return False


def _wiki_card_has_generated_content(wiki_card: SourceWikiCard) -> bool:
    return any(
        [
            bool(wiki_card.summary_text),
            bool(wiki_card.obsidian_markdown),
            bool(wiki_card.prompt_snapshot),
            bool(wiki_card.model_id),
            bool(wiki_card.topics),
            bool(wiki_card.methods),
            bool(wiki_card.problems),
            bool(wiki_card.contributions),
            bool(wiki_card.limitations),
            bool(wiki_card.related_sources),
        ]
    )


async def _reconcile_wiki_card_status(
    wiki_card: Optional[SourceWikiCard],
) -> Optional[SourceWikiCard]:
    if not wiki_card or wiki_card.status != "pending" or not wiki_card.command_id:
        return wiki_card

    try:
        command_status = await CommandService.get_command_status(wiki_card.command_id)
    except Exception as exc:
        logger.debug(
            f"Could not reconcile wiki card {wiki_card.id} using command {wiki_card.command_id}: {exc}"
        )
        return wiki_card

    normalized_status = command_status.get("status")
    if normalized_status == "failed":
        wiki_card.status = "failed"
        wiki_card.error_message = command_status.get("error_message")
        await wiki_card.save()
        return wiki_card

    if normalized_status == "completed" and _wiki_card_has_generated_content(wiki_card):
        wiki_card.status = "completed"
        wiki_card.error_message = None
        await wiki_card.save()

    return wiki_card


async def _serialize_wiki_card(
    wiki_card: Optional[SourceWikiCard],
    *,
    concept_lookup: Optional[Dict[str, tuple[str, str]]] = None,
    question_lookup: Optional[Dict[str, tuple[str, str]]] = None,
) -> Optional[SourceWikiCardResponse]:
    if not wiki_card:
        return None
    wiki_card = await _reconcile_wiki_card_status(wiki_card)
    return SourceWikiCardResponse(
        **(
            await serialize_source_wiki_card(
                wiki_card,
                concept_lookup=concept_lookup,
                question_lookup=question_lookup,
            )
        )
    )


async def _get_notebook_wiki_card_slots(
    notebook_id: str,
    *,
    concept_lookup: Optional[Dict[str, tuple[str, str]]] = None,
    question_lookup: Optional[Dict[str, tuple[str, str]]] = None,
) -> List[SourceWikiCardSlotResponse]:
    concept_lookup = concept_lookup or await get_concept_registry_lookup()
    question_lookup = question_lookup or await get_question_registry_lookup()
    rows = await _fetch_notebook_wiki_card_rows(notebook_id)

    items: List[SourceWikiCardSlotResponse] = []
    for row in rows:
        wiki_card_row = row.get("wiki_card")
        wiki_card = SourceWikiCard(**wiki_card_row) if wiki_card_row else None
        if wiki_card and _wiki_card_row_needs_cleanup(wiki_card_row):
            await wiki_card.save()
        serialized = await _serialize_wiki_card(
            wiki_card,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        items.append(
            SourceWikiCardSlotResponse(
                source_id=str(row.get("id", "")),
                source_title=row.get("title"),
                source_created=str(row.get("created", "")),
                source_updated=str(row.get("updated", "")),
                status=wiki_card.status if wiki_card else "missing",
                wiki_card=serialized,
            )
        )

    items.sort(
        key=lambda item: (
            item.wiki_card.updated if item.wiki_card else item.source_updated
        ),
        reverse=True,
    )
    return items


async def _get_all_wiki_cards(
    *,
    concept_lookup: Optional[Dict[str, tuple[str, str]]] = None,
    question_lookup: Optional[Dict[str, tuple[str, str]]] = None,
) -> List[SourceWikiCardResponse]:
    concept_lookup = concept_lookup or await get_concept_registry_lookup()
    question_lookup = question_lookup or await get_question_registry_lookup()

    wiki_cards = await SourceWikiCard.get_all(order_by="updated DESC")
    results: List[SourceWikiCardResponse] = []
    for wiki_card in wiki_cards:
        serialized = await _serialize_wiki_card(
            wiki_card,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        if serialized:
            results.append(serialized)
    return results


def _aggregate_concepts(
    wiki_cards: List[SourceWikiCardResponse],
    registry_rows: List[Concept],
    *,
    include_registry_orphans: bool = False,
) -> List[ConceptResponse]:
    aggregates: Dict[str, Dict[str, Any]] = {}

    if include_registry_orphans:
        for row in registry_rows:
            record_id = normalize_record_id_string(str(row.id or "").strip())
            if not record_id:
                continue
            aggregates.setdefault(
                record_id,
                {
                    "id": record_id,
                    "name": row.name,
                    "aliases": list(row.aliases or []),
                    "canonical_language": row.canonical_language,
                    "source_ids": [],
                    "source_titles": [],
                    "wiki_card_ids": [],
                },
            )

    for wiki_card in wiki_cards:
        for concept_id, concept_name in zip(wiki_card.concept_ids, wiki_card.concept_names):
            concept_id = normalize_record_id_string(str(concept_id))
            aggregate = aggregates.setdefault(
                concept_id,
                {
                    "id": concept_id,
                    "name": concept_name,
                    "aliases": [],
                    "canonical_language": None,
                    "source_ids": [],
                    "source_titles": [],
                    "wiki_card_ids": [],
                },
            )
            aggregate["name"] = aggregate.get("name") or concept_name
            aggregate["aliases"] = _dedupe_strings(
                list(aggregate.get("aliases", [])) + [concept_name]
            )
            aggregate["source_ids"] = _dedupe_strings(
                list(aggregate.get("source_ids", [])) + [wiki_card.source_id]
            )
            if wiki_card.source_title:
                aggregate["source_titles"] = _dedupe_strings(
                    list(aggregate.get("source_titles", [])) + [wiki_card.source_title]
                )
            aggregate["wiki_card_ids"] = _dedupe_strings(
                list(aggregate.get("wiki_card_ids", [])) + [wiki_card.id]
            )

    for row in registry_rows:
        record_id = normalize_record_id_string(str(row.id or "").strip())
        if not record_id or record_id not in aggregates:
            continue
        aggregate = aggregates[record_id]
        aggregate["name"] = row.name
        aggregate["canonical_language"] = row.canonical_language
        aggregate["aliases"] = _dedupe_strings(
            list(aggregate.get("aliases", [])) + list(row.aliases or []) + [row.name]
        )

    return [
        ConceptResponse(**aggregates[concept_id])
        for concept_id in sorted(
            aggregates,
            key=lambda value: (
                aggregates[value].get("name", "").casefold(),
                value,
            ),
        )
    ]


def _aggregate_questions(
    wiki_cards: List[SourceWikiCardResponse],
    registry_rows: List[Question],
    *,
    include_registry_orphans: bool = False,
) -> List[QuestionResponse]:
    aggregates: Dict[str, Dict[str, Any]] = {}

    if include_registry_orphans:
        for row in registry_rows:
            record_id = normalize_record_id_string(str(row.id or "").strip())
            if not record_id:
                continue
            aggregates.setdefault(
                record_id,
                {
                    "id": record_id,
                    "name": row.name,
                    "aliases": list(row.aliases or []),
                    "canonical_language": row.canonical_language,
                    "source_ids": [],
                    "source_titles": [],
                    "wiki_card_ids": [],
                },
            )

    for wiki_card in wiki_cards:
        for question_id, question_name in zip(
            wiki_card.question_ids,
            wiki_card.question_names,
        ):
            question_id = normalize_record_id_string(str(question_id))
            aggregate = aggregates.setdefault(
                question_id,
                {
                    "id": question_id,
                    "name": question_name,
                    "aliases": [],
                    "canonical_language": None,
                    "source_ids": [],
                    "source_titles": [],
                    "wiki_card_ids": [],
                },
            )
            aggregate["name"] = aggregate.get("name") or question_name
            aggregate["aliases"] = _dedupe_strings(
                list(aggregate.get("aliases", [])) + [question_name]
            )
            aggregate["source_ids"] = _dedupe_strings(
                list(aggregate.get("source_ids", [])) + [wiki_card.source_id]
            )
            if wiki_card.source_title:
                aggregate["source_titles"] = _dedupe_strings(
                    list(aggregate.get("source_titles", [])) + [wiki_card.source_title]
                )
            aggregate["wiki_card_ids"] = _dedupe_strings(
                list(aggregate.get("wiki_card_ids", [])) + [wiki_card.id]
            )

    for row in registry_rows:
        record_id = normalize_record_id_string(str(row.id or "").strip())
        if not record_id or record_id not in aggregates:
            continue
        aggregate = aggregates[record_id]
        aggregate["name"] = row.name
        aggregate["canonical_language"] = row.canonical_language
        aggregate["aliases"] = _dedupe_strings(
            list(aggregate.get("aliases", [])) + list(row.aliases or []) + [row.name]
        )

    return [
        QuestionResponse(**aggregates[question_id])
        for question_id in sorted(
            aggregates,
            key=lambda value: (
                aggregates[value].get("name", "").casefold(),
                value,
            ),
        )
    ]


def _aggregate_navigation_sections(
    wiki_cards: List[SourceWikiCardResponse],
    values_getter: Any,
) -> List[NotebookMocSectionResponse]:
    aggregates: Dict[str, Dict[str, Any]] = {}
    for wiki_card in wiki_cards:
        values = values_getter(wiki_card)
        for value in values:
            normalized = str(value).strip()
            if not normalized:
                continue
            aggregate = aggregates.setdefault(
                normalized,
                {
                    "id": normalized.replace("_", "-").replace(" ", "-").casefold(),
                    "label": normalized,
                    "count": 0,
                    "wiki_card_ids": [],
                    "source_ids": [],
                },
            )
            aggregate["count"] += 1
            aggregate["wiki_card_ids"] = _dedupe_strings(
                list(aggregate["wiki_card_ids"]) + [wiki_card.id]
            )
            aggregate["source_ids"] = _dedupe_strings(
                list(aggregate["source_ids"]) + [wiki_card.source_id]
            )

    return [
        NotebookMocSectionResponse(**aggregates[key])
        for key in sorted(
            aggregates,
            key=lambda value: (-aggregates[value]["count"], value.casefold()),
        )
    ]


async def _get_relation_responses_for_notebook(
    notebook_id: str,
    wiki_cards: List[SourceWikiCardSlotResponse],
) -> List[SourceRelationResponse]:
    relation_map: Dict[str, SourceRelationResponse] = {}
    try:
        stored_relations = await SourceRelation.get_all(order_by="updated DESC")
    except Exception:
        stored_relations = []

    for relation in stored_relations:
        if notebook_id not in relation.notebook_ids:
            continue
        serialized = await _serialize_relation_record(relation)
        relation_map[serialized.id] = serialized

    for slot in wiki_cards:
        if not slot.wiki_card:
            continue
        relation_entries = build_relation_entries(slot.wiki_card.model_dump())
        for relation_entry in relation_entries:
            if notebook_id not in relation_entry.get("notebook_ids", []):
                continue
            relation_id = str(relation_entry.get("id") or "")
            if not relation_id or relation_id in relation_map:
                continue
            relation_map[relation_id] = _serialize_relation_entry(
                relation_entry,
                created=slot.wiki_card.created,
                updated=slot.wiki_card.updated,
            )

    return sorted(
        relation_map.values(),
        key=lambda relation: relation.updated,
        reverse=True,
    )


async def _get_relation_responses_for_source(
    source_id: str,
) -> List[SourceRelationResponse]:
    relation_map: Dict[str, SourceRelationResponse] = {}
    try:
        stored_relations = await SourceRelation.get_all(order_by="updated DESC")
    except Exception:
        stored_relations = []

    for relation in stored_relations:
        if relation.source_id != source_id and relation.target_source_id != source_id:
            continue
        serialized = await _serialize_relation_record(relation)
        relation_map[serialized.id] = serialized

    concept_lookup, question_lookup = await _get_registry_lookups()
    wiki_cards = await _get_all_wiki_cards(
        concept_lookup=concept_lookup,
        question_lookup=question_lookup,
    )
    for wiki_card in wiki_cards:
        if wiki_card.source_id != source_id:
            continue
        relation_entries = build_relation_entries(wiki_card.model_dump())
        for relation_entry in relation_entries:
            relation_id = str(relation_entry.get("id") or "")
            if not relation_id or relation_id in relation_map:
                continue
            relation_map[relation_id] = _serialize_relation_entry(
                relation_entry,
                created=wiki_card.created,
                updated=wiki_card.updated,
            )

    return sorted(
        relation_map.values(),
        key=lambda relation: relation.updated,
        reverse=True,
    )


@router.get(
    "/notebooks/{notebook_id}/wiki-cards",
    response_model=List[SourceWikiCardSlotResponse],
)
async def get_notebook_wiki_cards(notebook_id: str):
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        concept_lookup, question_lookup = await _get_registry_lookups()
        return await _get_notebook_wiki_card_slots(
            notebook_id,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching wiki cards for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching wiki cards: {str(e)}"
        )


@router.get("/sources/{source_id}/wiki-card", response_model=SourceWikiCardSlotResponse)
async def get_source_wiki_card(source_id: str):
    try:
        source = await Source.get(source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Source not found")

        concept_lookup, question_lookup = await _get_registry_lookups()
        wiki_card = await source.get_wiki_card()
        serialized = await _serialize_wiki_card(
            wiki_card,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        return SourceWikiCardSlotResponse(
            source_id=str(source.id),
            source_title=source.title,
            source_created=str(source.created),
            source_updated=str(source.updated),
            status=wiki_card.status if wiki_card else "missing",
            wiki_card=serialized,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching wiki card for source {source_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching wiki card: {str(e)}"
        )


@router.get(
    "/notebooks/{notebook_id}/concepts",
    response_model=List[ConceptResponse],
)
async def get_notebook_concepts(notebook_id: str):
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        concept_lookup, question_lookup = await _get_registry_lookups()
        slots = await _get_notebook_wiki_card_slots(
            notebook_id,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        wiki_cards = [slot.wiki_card for slot in slots if slot.wiki_card]
        registry_rows = await _get_concept_registry_rows()
        return _aggregate_concepts(wiki_cards, registry_rows)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching concepts for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching concepts: {str(e)}"
        )


@router.get(
    "/notebooks/{notebook_id}/questions",
    response_model=List[QuestionResponse],
)
async def get_notebook_questions(notebook_id: str):
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        concept_lookup, question_lookup = await _get_registry_lookups()
        slots = await _get_notebook_wiki_card_slots(
            notebook_id,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        wiki_cards = [slot.wiki_card for slot in slots if slot.wiki_card]
        registry_rows = await _get_question_registry_rows()
        return _aggregate_questions(wiki_cards, registry_rows)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching questions for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching questions: {str(e)}"
        )


@router.get(
    "/notebooks/{notebook_id}/paper-types",
    response_model=List[NotebookMocSectionResponse],
)
async def get_notebook_paper_types(notebook_id: str):
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        concept_lookup, question_lookup = await _get_registry_lookups()
        slots = await _get_notebook_wiki_card_slots(
            notebook_id,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        wiki_cards = [slot.wiki_card for slot in slots if slot.wiki_card]
        return _aggregate_navigation_sections(
            wiki_cards,
            lambda card: [card.paper_type] if card.paper_type else [],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching paper types for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching paper types: {str(e)}"
        )


@router.get(
    "/notebooks/{notebook_id}/domains",
    response_model=List[NotebookMocSectionResponse],
)
async def get_notebook_domains(notebook_id: str):
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        concept_lookup, question_lookup = await _get_registry_lookups()
        slots = await _get_notebook_wiki_card_slots(
            notebook_id,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        wiki_cards = [slot.wiki_card for slot in slots if slot.wiki_card]
        return _aggregate_navigation_sections(wiki_cards, lambda card: card.domains)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching domains for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching domains: {str(e)}"
        )


@router.get(
    "/notebooks/{notebook_id}/moc",
    response_model=NotebookMocResponse,
)
async def get_notebook_moc(notebook_id: str):
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        concept_lookup, question_lookup = await _get_registry_lookups()
        slots = await _get_notebook_wiki_card_slots(
            notebook_id,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        wiki_cards = [slot.wiki_card for slot in slots if slot.wiki_card]
        key_papers = [card for card in wiki_cards if card.is_key_paper][:12]
        recently_updated = sorted(
            wiki_cards,
            key=lambda card: card.updated,
            reverse=True,
        )[:12]
        return NotebookMocResponse(
            notebook_id=notebook_id,
            paper_types=_aggregate_navigation_sections(
                wiki_cards,
                lambda card: [card.paper_type] if card.paper_type else [],
            ),
            domains=_aggregate_navigation_sections(
                wiki_cards,
                lambda card: card.domains,
            ),
            moc_groups=_aggregate_navigation_sections(
                wiki_cards,
                lambda card: card.moc_groups,
            ),
            key_papers=key_papers,
            recently_updated=recently_updated,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching MOC metadata for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching MOC metadata: {str(e)}"
        )


@router.get(
    "/notebooks/{notebook_id}/moc-lite",
    response_model=NotebookMocLiteResponse,
)
async def get_notebook_moc_lite(notebook_id: str):
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        concept_lookup, question_lookup = await _get_registry_lookups()
        slots = await _get_notebook_wiki_card_slots(
            notebook_id,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        wiki_cards = [slot.wiki_card for slot in slots if slot.wiki_card]
        key_papers = [card.id for card in wiki_cards if card.is_key_paper][:24]
        recently_updated = [
            card.id
            for card in sorted(
                wiki_cards,
                key=lambda card: card.updated,
                reverse=True,
            )[:24]
        ]
        return NotebookMocLiteResponse(
            notebook_id=notebook_id,
            paper_types=_aggregate_navigation_sections(
                wiki_cards,
                lambda card: [card.paper_type] if card.paper_type else [],
            ),
            domains=_aggregate_navigation_sections(
                wiki_cards,
                lambda card: card.domains,
            ),
            moc_groups=_aggregate_navigation_sections(
                wiki_cards,
                lambda card: card.moc_groups,
            ),
            key_paper_ids=key_papers,
            recently_updated_ids=recently_updated,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching lightweight MOC metadata for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching lightweight MOC metadata: {str(e)}"
        )


@router.get(
    "/concepts/{concept_id}",
    response_model=ConceptResponse,
)
async def get_concept(concept_id: str):
    try:
        concept_lookup, question_lookup = await _get_registry_lookups()
        wiki_cards = await _get_all_wiki_cards(
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        concepts = _aggregate_concepts(
            wiki_cards,
            await _get_concept_registry_rows(),
            include_registry_orphans=True,
        )
        for concept in concepts:
            if concept.id == concept_id:
                return concept
        raise HTTPException(status_code=404, detail="Concept not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching concept {concept_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching concept: {str(e)}"
        )


@router.get(
    "/questions/{question_id}",
    response_model=QuestionResponse,
)
async def get_question(question_id: str):
    try:
        concept_lookup, question_lookup = await _get_registry_lookups()
        wiki_cards = await _get_all_wiki_cards(
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        questions = _aggregate_questions(
            wiki_cards,
            await _get_question_registry_rows(),
            include_registry_orphans=True,
        )
        for question in questions:
            if question.id == question_id:
                return question
        raise HTTPException(status_code=404, detail="Question not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching question {question_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching question: {str(e)}"
        )


@router.get(
    "/notebooks/{notebook_id}/relations",
    response_model=List[SourceRelationResponse],
)
async def get_notebook_relations(notebook_id: str):
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        concept_lookup, question_lookup = await _get_registry_lookups()
        slots = await _get_notebook_wiki_card_slots(
            notebook_id,
            concept_lookup=concept_lookup,
            question_lookup=question_lookup,
        )
        return await _get_relation_responses_for_notebook(notebook_id, slots)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching relations for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching relations: {str(e)}"
        )


@router.get(
    "/sources/{source_id}/relations",
    response_model=List[SourceRelationResponse],
)
async def get_source_relations(source_id: str):
    try:
        source = await Source.get(source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Source not found")

        return await _get_relation_responses_for_source(str(source.id))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching relations for source {source_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching source relations: {str(e)}"
        )


@router.post(
    "/sources/{source_id}/wiki-card",
    response_model=WikiCardCreationResponse,
    status_code=202,
)
async def create_source_wiki_card(
    source_id: str, request: CreateSourceWikiCardRequest
) -> WikiCardCreationResponse:
    try:
        source = await Source.get(source_id)
        if not source:
            raise HTTPException(status_code=404, detail="Source not found")

        existing = await source.get_wiki_card()
        if existing and existing.status == "pending" and existing.command_id:
            existing = await _reconcile_wiki_card_status(existing)
        if existing and existing.status == "pending" and existing.command_id:
            return WikiCardCreationResponse(
                source_id=source_id,
                wiki_card_id=str(existing.id),
                command_id=existing.command_id,
                message="Wiki card generation is already in progress",
            )

        wiki_card = await upsert_pending_wiki_card(source, existing=existing)

        command_id = submit_command(
            "open_notebook",
            "generate_wiki_card",
            {
                "source_id": source_id,
                "wiki_card_id": str(wiki_card.id),
                "model_id": request.model_id,
            },
        )
        wiki_card.command_id = str(command_id)
        await wiki_card.save()

        return WikiCardCreationResponse(
            source_id=source_id,
            wiki_card_id=str(wiki_card.id),
            command_id=str(command_id),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting wiki card generation for source {source_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error starting wiki card generation: {str(e)}"
        )


@router.post(
    "/wiki-cards/{wiki_card_id}/refresh",
    response_model=WikiCardCreationResponse,
    status_code=202,
)
async def refresh_wiki_card(
    wiki_card_id: str, request: RefreshWikiCardRequest
) -> WikiCardCreationResponse:
    try:
        wiki_card = await SourceWikiCard.get(wiki_card_id)
        if not wiki_card:
            raise HTTPException(status_code=404, detail="Wiki card not found")
        if wiki_card.status == "pending" and wiki_card.command_id:
            wiki_card = await _reconcile_wiki_card_status(wiki_card)
        if wiki_card.status == "pending" and wiki_card.command_id:
            source = await wiki_card.get_source()
            return WikiCardCreationResponse(
                source_id=str(source.id),
                wiki_card_id=str(wiki_card.id),
                command_id=wiki_card.command_id,
                message="Wiki card generation is already in progress",
            )

        source = await wiki_card.get_source()
        wiki_card = await upsert_pending_wiki_card(source, existing=wiki_card)

        command_id = submit_command(
            "open_notebook",
            "generate_wiki_card",
            {
                "source_id": str(source.id),
                "wiki_card_id": str(wiki_card.id),
                "model_id": request.model_id or wiki_card.model_id,
            },
        )
        wiki_card.command_id = str(command_id)
        await wiki_card.save()

        return WikiCardCreationResponse(
            source_id=str(source.id),
            wiki_card_id=str(wiki_card.id),
            command_id=str(command_id),
            message="Wiki card refresh started",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error refreshing wiki card {wiki_card_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error refreshing wiki card: {str(e)}"
        )
