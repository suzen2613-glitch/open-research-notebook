import json
import re
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger

from open_notebook.ai.provision import provision_langchain_model
from open_notebook.database.repository import (
    ensure_record_id,
    normalize_record_id_string,
    repo_query,
    repo_upsert,
)
from open_notebook.domain.notebook import (
    Concept,
    Question,
    Source,
    SourceEmbedding,
    SourceRelation,
    SourceWikiCard,
)
from open_notebook.services.source_summary import SOURCE_SUMMARY_TITLE
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.text_utils import extract_text_content

SOURCE_WIKI_CARD_TITLE = "Wiki Card"

SOURCE_WIKI_CARD_PROMPT = """
你正在为 Open Notebook 生成一张面向 Obsidian / LLM wiki 的结构化论文卡片。

目标：
- 只基于提供的论文内容和已有 summary 抽取稳定的结构化信息
- 输出必须是单个合法 JSON 对象
- 不要输出 Markdown、解释、前后缀说明或代码围栏
- 若原文未明确说明，使用 null、空字符串或空数组，不要推断
- related_sources 只能引用 LOCAL_SOURCE_CANDIDATES 中出现的 source_id；如果无法明确匹配，则返回 []
- topics / methods / problems 保持论文原文或已有 summary 的自然语言表述，不要为了统一而强行翻译；canonical 归一化由后端完成
- paper_type 只能从以下值中选择一个：review, foundational, method, application, benchmark
- 如果论文是 survey/overview 类广义综述，也统一归到 review
- domains 只能从以下值中选择一个或多个：llm, rag, agents, multimodal, code_generation, evaluation, safety, ai_infra

请严格按下面的 JSON 结构输出，字段不能缺失：
{
  "title": "",
  "short_title": "",
  "authors": [],
  "year": null,
  "venue": "",
  "paper_type": "",
  "domains": [],
  "summary_text": "",
  "topics": [],
  "methods": [],
  "problems": [],
  "contributions": [],
  "limitations": [],
  "keywords": [],
  "core_concepts": [],
  "moc_groups": [],
  "recommended_entry_points": [],
  "is_key_paper": false,
  "related_sources": [
    {
      "source_id": "",
      "relation_type": "",
      "reason": ""
    }
  ]
}

字段要求：
- title: 论文标题
- short_title: 适合导航页/Dataview 展示的短标题，3-8 个词；如果无法压缩就返回 title
- authors: 作者数组
- year: 整数年份；不明确时为 null
- venue: 会议、期刊或出版信息；不明确时为空字符串
- paper_type: 只能从指定候选中选择
- domains: 只能从指定候选中选择一个或多个
- summary_text: 200-400 字的规范化摘要，适合作为 wiki 卡片摘要
- topics: 主题或研究对象，3-8 项
- methods: 关键方法、模型、算法或实验策略，2-8 项
- problems: 论文试图解决的核心问题，1-6 项
- contributions: 主要贡献，2-6 项
- limitations: 原文明确提到的限制，0-5 项
- keywords: 用于导航和搜索的展示型关键词，3-8 项
- core_concepts: 最适合做导航/MOC 的核心概念，1-5 项
- moc_groups: 推荐归入的 MOC 分组名称，0-6 项
- recommended_entry_points: 适合导航入口的 canonical concept 或 domain 标识，例如 concept:llm、domain:rag
- is_key_paper: 是否是该主题下的代表性/入口论文，布尔值
- related_sources: 仅当 LOCAL_SOURCE_CANDIDATES 中有明确相关项时填写

relation_type 建议值：
- extends
- compares_with
- applies
- benchmark_for
- criticizes
- uses
- improves
- related_work
""".strip()

WIKI_CARD_STATUS_VALUES = {"pending", "completed", "failed"}
ALLOWED_RELATION_TYPES = {
    "extends",
    "compares_with",
    "applies",
    "benchmark_for",
    "criticizes",
    "uses",
    "improves",
    "related_work",
}
PLACEHOLDER_LOOKUP_KEYS = {
    "untitled",
    "untitled source",
    "unknown",
    "none",
    "null",
    "nil",
    "n a",
    "na",
    "not stated",
    "not stated in the source",
    "not provided",
    "not available",
    "unspecified",
    "tbd",
}
RELATION_TYPE_ALIASES = {
    "extend": "extends",
    "extends": "extends",
    "extension": "extends",
    "builds on": "extends",
    "compare": "compares_with",
    "compares with": "compares_with",
    "compared with": "compares_with",
    "comparison": "compares_with",
    "contrasts with": "compares_with",
    "apply": "applies",
    "applies": "applies",
    "applied to": "applies",
    "application": "applies",
    "benchmark": "benchmark_for",
    "benchmark for": "benchmark_for",
    "serves as benchmark": "benchmark_for",
    "criticize": "criticizes",
    "criticizes": "criticizes",
    "criticise": "criticizes",
    "criticises": "criticizes",
    "challenge": "criticizes",
    "challenges": "criticizes",
    "use": "uses",
    "uses": "uses",
    "used by": "uses",
    "based on": "uses",
    "leverages": "uses",
    "improve": "improves",
    "improves": "improves",
    "improved": "improves",
    "improvement": "improves",
    "related": "related_work",
    "related work": "related_work",
    "related_work": "related_work",
    "related-work": "related_work",
}
REQUIRED_WIKI_CARD_FIELDS = {
    "title",
    "short_title",
    "authors",
    "year",
    "venue",
    "paper_type",
    "domains",
    "summary_text",
    "topics",
    "methods",
    "problems",
    "contributions",
    "limitations",
    "keywords",
    "core_concepts",
    "moc_groups",
    "recommended_entry_points",
    "is_key_paper",
    "related_sources",
}
WIKI_CARD_LIST_FIELDS = {
    "authors",
    "domains",
    "topics",
    "methods",
    "problems",
    "contributions",
    "limitations",
    "keywords",
    "core_concepts",
    "moc_groups",
    "recommended_entry_points",
}
ALLOWED_PAPER_TYPES = {
    "review",
    "foundational",
    "method",
    "application",
    "benchmark",
}
ALLOWED_DOMAINS = {
    "llm",
    "rag",
    "agents",
    "multimodal",
    "code_generation",
    "evaluation",
    "safety",
    "ai_infra",
}
PAPER_TYPE_ALIASES = {
    "review": "review",
    "survey": "review",
    "survey paper": "review",
    "overview": "review",
    "overview paper": "review",
    "foundational": "foundational",
    "foundation": "foundational",
    "theory": "foundational",
    "method": "method",
    "methods": "method",
    "method improvement": "method",
    "application": "application",
    "applications": "application",
    "applied": "application",
    "benchmark": "benchmark",
    "evaluation": "benchmark",
}
DOMAIN_ALIASES = {
    "llm": "llm",
    "large language model": "llm",
    "large language models": "llm",
    "language model": "llm",
    "language models": "llm",
    "rag": "rag",
    "retrieval augmented generation": "rag",
    "retrieval-augmented generation": "rag",
    "agents": "agents",
    "agent": "agents",
    "agent systems": "agents",
    "multimodal": "multimodal",
    "multi modal": "multimodal",
    "multimodal ai": "multimodal",
    "code generation": "code_generation",
    "code_generation": "code_generation",
    "coding assistants": "code_generation",
    "evaluation": "evaluation",
    "eval": "evaluation",
    "benchmarking": "evaluation",
    "safety": "safety",
    "ai safety": "safety",
    "alignment": "safety",
    "ai infrastructure": "ai_infra",
    "ai infra": "ai_infra",
    "ai_infra": "ai_infra",
    "infrastructure": "ai_infra",
}
LANGUAGE_VALUES = {"en", "zh", "mixed", "unknown"}
MAX_DOMAIN_COUNT = 3
MAX_CORE_CONCEPT_COUNT = 4
MAX_SHORT_TITLE_WORDS = 8
MAX_KEYWORD_COUNT = 8
DOMAIN_DISPLAY_LABELS = {
    "llm": "LLM",
    "rag": "RAG",
    "agents": "Agents",
    "multimodal": "Multimodal AI",
    "code_generation": "Code Generation",
    "evaluation": "Evaluation",
    "safety": "AI Safety",
    "ai_infra": "AI Infrastructure",
}
MOC_GROUP_PAPER_TYPE_LABELS = {
    "review": "Reviews",
    "foundational": "Foundations",
    "method": "Methods",
    "application": "Applications",
    "benchmark": "Benchmarks",
}
MOC_GROUP_HUB_LABELS = {
    "concept:llm": "LLM",
    "concept:rag": "RAG",
    "concept:agents": "Agents",
    "concept:multimodal-ai": "Multimodal AI",
    "concept:code-assistants": "Code Assistants",
}
WIKI_CARD_COVERAGE_FIELDS = (
    "summary_text",
    "topics",
    "methods",
    "problems",
    "contributions",
    "limitations",
    "related_sources",
)


def _dedupe_preserve_order(values: List[str]) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized:
            continue
        key = normalized.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def _normalize_string_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return _dedupe_preserve_order([value])
    if isinstance(value, list):
        return _dedupe_preserve_order(
            [str(item).strip() for item in value if str(item).strip()]
        )
    return _dedupe_preserve_order([str(value)])


def _normalize_optional_string(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_lookup_key(value: str) -> str:
    normalized = value.strip().casefold()
    normalized = re.sub(r"[“”\"'`]+", "", normalized)
    normalized = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def _to_title_case_label(value: str) -> str:
    return DOMAIN_DISPLAY_LABELS.get(value, value.replace("_", " ").strip().title())


def _contains_cjk(value: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", value))


def _contains_latin(value: str) -> bool:
    return bool(re.search(r"[A-Za-z]", value))


def _detect_text_language(value: Any) -> str:
    normalized = _normalize_optional_string(value)
    if not normalized:
        return "unknown"

    has_cjk = _contains_cjk(normalized)
    has_latin = _contains_latin(normalized)
    if has_cjk and has_latin:
        return "mixed"
    if has_latin:
        return "en"
    if has_cjk:
        return "zh"
    return "unknown"


def _detect_language(values: List[Any]) -> str:
    languages = {
        _detect_text_language(value)
        for value in values
        if _normalize_optional_string(value)
    }
    languages.discard("unknown")
    if not languages:
        return "unknown"
    if "mixed" in languages or len(languages) > 1:
        return "mixed"
    return next(iter(languages))


def _canonical_name_score(value: str) -> tuple[int, int, int, str]:
    language = _detect_text_language(value)
    if language == "en":
        language_score = 100
    elif language == "mixed":
        language_score = 70
    elif language == "zh":
        language_score = 30
    else:
        language_score = 10

    acronym_bonus = 0
    normalized = value.strip()
    if re.fullmatch(r"[A-Z][A-Z0-9\-]{1,15}s?", normalized):
        acronym_bonus = 25
    elif normalized and normalized[0].isupper():
        acronym_bonus = 10

    punctuation_penalty = normalized.count("/") + normalized.count(",") + normalized.count(";")
    return (
        language_score + acronym_bonus - punctuation_penalty,
        -len(normalized),
        -normalized.count(" "),
        normalized.casefold(),
    )


def _choose_canonical_name(
    primary_name: Optional[str],
    aliases: List[str],
) -> tuple[Optional[str], str]:
    candidates = _normalize_alias_list(
        ([primary_name] if primary_name else []) + list(aliases)
    )
    if not candidates:
        return None, "unknown"

    best_name = sorted(candidates, key=_canonical_name_score, reverse=True)[0]
    return best_name, _detect_text_language(best_name)


def _register_concept_aliases(
    concept_id: str, concept_name: str, *aliases: str
) -> Dict[str, tuple[str, str]]:
    registry: Dict[str, tuple[str, str]] = {}
    for alias in aliases:
        key = _normalize_lookup_key(alias)
        if key:
            registry[key] = (concept_id, concept_name)
    return registry


CANONICAL_CONCEPT_ALIASES: Dict[str, tuple[str, str]] = {
    **_register_concept_aliases(
        "concept:llm",
        "LLM",
        "LLM",
        "LLMs",
        "Large Language Model",
        "Large Language Models",
        "language model",
        "language models",
    ),
    **_register_concept_aliases(
        "concept:rag",
        "RAG",
        "RAG",
        "Retrieval Augmented Generation",
        "Retrieval-Augmented Generation",
    ),
    **_register_concept_aliases(
        "concept:agents",
        "Agents",
        "AI Agent",
        "AI Agents",
        "Agent System",
        "Agent Systems",
    ),
    **_register_concept_aliases(
        "concept:multimodal-ai",
        "Multimodal AI",
        "Multimodal Model",
        "Multimodal Models",
        "Vision Language Model",
        "Vision-Language Model",
    ),
}
CANONICAL_QUESTION_ALIASES: Dict[str, tuple[str, str]] = {}


def _normalize_year(value: Any) -> Optional[int]:
    if value in (None, "", "null"):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)

    match = re.search(r"\b(19|20)\d{2}\b", str(value))
    if match:
        return int(match.group(0))
    return None


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "untitled-source"


def _slugify_identifier(value: str) -> Optional[str]:
    slug = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "-", value.casefold()).strip("-")
    return slug or None


def _normalize_wiki_label(value: Any) -> Optional[str]:
    normalized = _normalize_optional_string(value)
    if not normalized:
        return None

    normalized = re.sub(r"^[\-\*\u2022\d\.\)\s]+", "", normalized).strip()
    normalized = re.sub(r"\s+", " ", normalized)
    lookup_key = _normalize_lookup_key(normalized)
    if not lookup_key or lookup_key in PLACEHOLDER_LOOKUP_KEYS:
        return None
    return normalized


def _normalize_named_list(value: Any) -> List[str]:
    if value is None:
        return []

    raw_values = value if isinstance(value, list) else [value]
    seen: set[str] = set()
    result: List[str] = []

    for raw_value in raw_values:
        normalized = _normalize_wiki_label(raw_value)
        if not normalized:
            continue
        key = normalized.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)

    return result


def _normalize_alias_list(values: List[str]) -> List[str]:
    aliases: List[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = _normalize_wiki_label(value)
        if not normalized:
            continue
        key = _normalize_lookup_key(normalized)
        if not key or key in seen:
            continue
        seen.add(key)
        aliases.append(normalized)
    return aliases


def _normalize_relation_type(value: Any) -> str:
    normalized = _normalize_optional_string(value)
    if not normalized:
        return "related_work"

    lookup_key = _normalize_lookup_key(normalized)
    relation_type = RELATION_TYPE_ALIASES.get(lookup_key, lookup_key.replace(" ", "_"))
    if relation_type not in ALLOWED_RELATION_TYPES:
        return "related_work"
    return relation_type


def _normalize_paper_type(value: Any) -> Optional[str]:
    normalized = _normalize_optional_string(value)
    if not normalized:
        return None
    lookup_key = _normalize_lookup_key(normalized)
    paper_type = PAPER_TYPE_ALIASES.get(lookup_key, lookup_key.replace(" ", "_"))
    if paper_type not in ALLOWED_PAPER_TYPES:
        return None
    return paper_type


def _normalize_domains(value: Any) -> List[str]:
    result: List[str] = []
    seen: set[str] = set()
    for raw_value in value if isinstance(value, list) else [value]:
        normalized = _normalize_optional_string(raw_value)
        if not normalized:
            continue
        lookup_key = _normalize_lookup_key(normalized)
        domain = DOMAIN_ALIASES.get(lookup_key, lookup_key.replace(" ", "_"))
        if domain not in ALLOWED_DOMAINS or domain in seen:
            continue
        seen.add(domain)
        result.append(domain)
        if len(result) >= MAX_DOMAIN_COUNT:
            break
    return result


def _normalize_navigation_record_id(prefix: str, value: Any) -> Optional[str]:
    normalized = _normalize_optional_string(value)
    if not normalized:
        return None
    slug = _slugify_identifier(_normalize_lookup_key(normalized))
    if not slug:
        return None
    return f"{prefix}:{slug}"


def _format_navigation_domain_entry(domain: str) -> str:
    return f"domain:{domain.replace('_', '-')}"


def _normalize_entry_points(value: Any) -> List[str]:
    result: List[str] = []
    seen: set[str] = set()
    for raw_value in value if isinstance(value, list) else [value]:
        normalized = _normalize_optional_string(raw_value)
        if not normalized:
            continue
        if ":" in normalized:
            prefix, suffix = normalized.split(":", 1)
            prefix = prefix.strip().casefold()
            suffix = suffix.strip()
            if prefix == "domain":
                domains = _normalize_domains([suffix])
                if not domains:
                    continue
                normalized_entry = _format_navigation_domain_entry(domains[0])
            elif prefix in {"concept", "question"}:
                normalized_entry = _normalize_navigation_record_id(prefix, suffix)
                if not normalized_entry:
                    continue
            else:
                continue
        else:
            domains = _normalize_domains([normalized])
            if domains:
                normalized_entry = _format_navigation_domain_entry(domains[0])
            else:
                normalized_entry = _normalize_navigation_record_id("concept", normalized)
                if not normalized_entry:
                    continue
        key = normalized_entry.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized_entry)
    return result


def _clip_short_title(value: Optional[str]) -> Optional[str]:
    normalized = _normalize_optional_string(value)
    if not normalized:
        return None

    words = normalized.split()
    if len(words) <= MAX_SHORT_TITLE_WORDS:
        return normalized

    for segment in re.split(r"\s*[:\-–—]\s*", normalized):
        segment = _normalize_optional_string(segment)
        if not segment:
            continue
        segment_words = segment.split()
        if 2 <= len(segment_words) <= MAX_SHORT_TITLE_WORDS:
            return segment

    return " ".join(words[:MAX_SHORT_TITLE_WORDS]).strip()


def _build_short_title(title: Optional[str], topics: List[str], methods: List[str]) -> Optional[str]:
    normalized_title = _normalize_optional_string(title)
    if normalized_title:
        clipped_title = _clip_short_title(normalized_title)
        if clipped_title and len(clipped_title.split()) <= MAX_SHORT_TITLE_WORDS:
            return clipped_title

    for candidate in methods + topics:
        clipped_candidate = _clip_short_title(candidate)
        if clipped_candidate and len(clipped_candidate.split()) <= MAX_SHORT_TITLE_WORDS:
            return clipped_candidate

    if methods and topics:
        combo = _clip_short_title(f"{methods[0]} for {topics[0]}")
        if combo and len(combo.split()) <= MAX_SHORT_TITLE_WORDS:
            return combo

    return _clip_short_title(normalized_title)


def _build_concept_fields(*value_groups: List[str]) -> tuple[List[str], List[str]]:
    concept_ids: List[str] = []
    concept_names: List[str] = []
    seen_ids: set[str] = set()

    for values in value_groups:
        for value in values:
            normalized = _normalize_wiki_label(value)
            if not normalized:
                continue

            lookup_key = _normalize_lookup_key(normalized)
            concept_ref = CANONICAL_CONCEPT_ALIASES.get(lookup_key)
            if concept_ref:
                concept_id, concept_name = concept_ref
            else:
                slug = _slugify_identifier(lookup_key)
                if not slug:
                    continue
                concept_id = f"concept:{slug}"
                concept_name = normalized

            if concept_id in seen_ids:
                continue

            seen_ids.add(concept_id)
            concept_ids.append(concept_id)
            concept_names.append(concept_name)

    return concept_ids, concept_names


def _build_question_fields(values: List[str]) -> tuple[List[str], List[str]]:
    question_ids: List[str] = []
    question_names: List[str] = []
    seen_ids: set[str] = set()

    for value in values:
        normalized = _normalize_wiki_label(value)
        if not normalized:
            continue

        lookup_key = _normalize_lookup_key(normalized)
        question_ref = CANONICAL_QUESTION_ALIASES.get(lookup_key)
        if question_ref:
            question_id, question_name = question_ref
        else:
            slug = _slugify_identifier(lookup_key)
            if not slug:
                continue
            question_id = f"question:{slug}"
            question_name = normalized
        if question_id in seen_ids:
            continue

        seen_ids.add(question_id)
        question_ids.append(question_id)
        question_names.append(question_name)

    return question_ids, question_names


def _default_concept_pair(value: str) -> Optional[tuple[str, str]]:
    normalized = _normalize_wiki_label(value)
    if not normalized:
        return None

    lookup_key = _normalize_lookup_key(normalized)
    concept_ref = CANONICAL_CONCEPT_ALIASES.get(lookup_key)
    if concept_ref:
        return concept_ref

    slug = _slugify_identifier(lookup_key)
    if not slug:
        return None
    return (f"concept:{slug}", normalized)


def _default_question_pair(value: str) -> Optional[tuple[str, str]]:
    normalized = _normalize_wiki_label(value)
    if not normalized:
        return None

    lookup_key = _normalize_lookup_key(normalized)
    question_ref = CANONICAL_QUESTION_ALIASES.get(lookup_key)
    if question_ref:
        return question_ref

    slug = _slugify_identifier(lookup_key)
    if not slug:
        return None
    return (f"question:{slug}", normalized)


def _resolve_concept_name(
    concept_id: str,
    concept_ids: List[str],
    concept_names: List[str],
) -> Optional[str]:
    normalized_id = normalize_record_id_string(str(concept_id))
    for current_id, current_name in zip(concept_ids, concept_names):
        if normalize_record_id_string(str(current_id)) == normalized_id:
            return current_name
    return None


def _build_core_concept_ids(
    seed_values: List[str],
    concept_ids: List[str],
    concept_names: List[str],
) -> List[str]:
    selected_ids: List[str] = []
    seen: set[str] = set()

    for value in seed_values:
        pair = _default_concept_pair(str(value))
        if not pair:
            continue
        concept_id, _ = pair
        concept_id = normalize_record_id_string(concept_id)
        if concept_id not in concept_ids or concept_id in seen:
            continue
        seen.add(concept_id)
        selected_ids.append(concept_id)
        if len(selected_ids) >= MAX_CORE_CONCEPT_COUNT:
            return selected_ids

    for concept_id in concept_ids:
        normalized_id = normalize_record_id_string(str(concept_id))
        if normalized_id in seen:
            continue
        seen.add(normalized_id)
        selected_ids.append(normalized_id)
        if len(selected_ids) >= MAX_CORE_CONCEPT_COUNT:
            break

    return selected_ids


def _build_keywords(
    *,
    topics: List[str],
    methods: List[str],
    problems: List[str],
    concept_names: List[str],
) -> List[str]:
    return _normalize_named_list(topics + methods + problems + concept_names)[:MAX_KEYWORD_COUNT]


def _resolve_moc_hub_label(
    *,
    concept_ids: List[str],
    concept_names: List[str],
    core_concept_ids: List[str],
) -> str:
    normalized_candidates: List[str] = []
    for concept_id in core_concept_ids + concept_ids:
        normalized_id = normalize_record_id_string(str(concept_id))
        if normalized_id:
            normalized_candidates.append(normalized_id)

    for concept_id in normalized_candidates:
        label = MOC_GROUP_HUB_LABELS.get(concept_id)
        if label:
            return label

    for concept_name in concept_names:
        pair = _default_concept_pair(concept_name)
        if not pair:
            continue
        label = MOC_GROUP_HUB_LABELS.get(normalize_record_id_string(pair[0]))
        if label:
            return label

    return "AI Systems"


def _build_moc_groups(
    *,
    paper_type: Optional[str],
    domains: List[str],
    concept_ids: List[str],
    concept_names: List[str],
    core_concept_ids: List[str],
) -> List[str]:
    hub_label = _resolve_moc_hub_label(
        concept_ids=concept_ids,
        concept_names=concept_names,
        core_concept_ids=core_concept_ids,
    )
    groups: List[str] = []
    if paper_type:
        groups.append(f"{hub_label} - {MOC_GROUP_PAPER_TYPE_LABELS.get(paper_type, 'Papers')}")
    if hub_label != "AI Systems":
        groups.append(f"{hub_label} - AI Systems")
    if not groups:
        groups.append(f"{hub_label} - Papers")
    return _dedupe_preserve_order(groups[:2])


def _build_recommended_entry_points(
    *,
    core_concept_ids: List[str],
    domains: List[str],
    raw_values: List[str],
) -> List[str]:
    entry_points: List[str] = []
    seen: set[str] = set()

    for entry in _normalize_entry_points(raw_values):
        key = entry.casefold()
        if key in seen:
            continue
        seen.add(key)
        entry_points.append(entry)

    for concept_id in core_concept_ids[:MAX_CORE_CONCEPT_COUNT]:
        suffix = str(concept_id).split(":", 1)[1] if ":" in str(concept_id) else str(concept_id)
        normalized_id = _normalize_navigation_record_id("concept", suffix)
        if not normalized_id:
            continue
        key = normalized_id.casefold()
        if key in seen:
            continue
        seen.add(key)
        entry_points.append(normalized_id)

    for domain in domains[:MAX_DOMAIN_COUNT]:
        entry = _format_navigation_domain_entry(domain)
        key = entry.casefold()
        if key in seen:
            continue
        seen.add(key)
        entry_points.append(entry)

    return entry_points


def _normalize_is_key_paper(
    value: Any,
    *,
    paper_type: Optional[str],
    contributions: List[str],
    core_concept_ids: List[str],
) -> bool:
    if isinstance(value, bool):
        return value
    normalized = _normalize_optional_string(value)
    if normalized:
        if normalized.casefold() in {"true", "yes", "1"}:
            return True
        if normalized.casefold() in {"false", "no", "0"}:
            return False
    return bool(
        paper_type in {"review", "survey", "foundational"}
        or len(contributions) >= 4
        or len(core_concept_ids) >= 3
    )


async def _build_registry_lookup(
    model_cls: type[Concept] | type[Question],
) -> Dict[str, tuple[str, str]]:
    try:
        rows = await model_cls.get_all(order_by="updated DESC")
    except Exception as exc:
        logger.debug(f"Could not load {model_cls.table_name} registry: {exc}")
        return {}

    lookup: Dict[str, tuple[str, str]] = {}
    for row in rows:
        record_id = normalize_record_id_string(str(row.id or "").strip())
        if not record_id:
            continue

        for alias in [row.name, *(row.aliases or [])]:
            lookup_key = _normalize_lookup_key(alias)
            if not lookup_key or lookup_key in lookup:
                continue
            lookup[lookup_key] = (record_id, row.name)

    return lookup


async def get_concept_registry_lookup() -> Dict[str, tuple[str, str]]:
    return await _build_registry_lookup(Concept)


async def get_question_registry_lookup() -> Dict[str, tuple[str, str]]:
    return await _build_registry_lookup(Question)


def _canonicalize_registry_pairs(
    *,
    display_values: List[str],
    current_ids: List[str],
    current_names: List[str],
    registry_lookup: Dict[str, tuple[str, str]],
    default_builder: Any,
) -> tuple[List[str], List[str]]:
    current_lookup: Dict[str, tuple[str, str]] = {}
    current_id_lookup: Dict[str, str] = {}
    for current_id, current_name in zip(current_ids, current_names):
        current_id = normalize_record_id_string(str(current_id)) if current_id else ""
        lookup_key = _normalize_lookup_key(current_name)
        if lookup_key:
            current_lookup[lookup_key] = (current_id, current_name)
        if current_id:
            current_id_lookup[current_id] = current_name

    normalized_pairs: List[tuple[str, str]] = []
    seen_ids: set[str] = set()
    seen_lookup_keys: set[str] = set()
    candidate_values = display_values + current_names

    for raw_value in candidate_values:
        normalized = _normalize_wiki_label(raw_value)
        if not normalized:
            continue

        lookup_key = _normalize_lookup_key(normalized)
        pair = registry_lookup.get(lookup_key) or current_lookup.get(lookup_key)
        if not pair:
            pair = default_builder(normalized)
        if not pair:
            continue

        canonical_id, canonical_name = pair
        canonical_id = normalize_record_id_string(str(canonical_id))
        if canonical_id in seen_ids:
            continue
        seen_ids.add(canonical_id)
        seen_lookup_keys.add(lookup_key)
        normalized_pairs.append((canonical_id, canonical_name))

    for current_id, current_name in zip(current_ids, current_names):
        current_id = normalize_record_id_string(str(current_id)) if current_id else ""
        lookup_key = _normalize_lookup_key(current_name)
        if lookup_key and lookup_key in seen_lookup_keys:
            continue
        if not current_id or current_id in seen_ids:
            continue
        fallback_name = current_id_lookup.get(current_id) or current_name
        if not fallback_name:
            continue
        seen_ids.add(current_id)
        normalized_pairs.append((current_id, fallback_name))

    return (
        [canonical_id for canonical_id, _ in normalized_pairs],
        [canonical_name for _, canonical_name in normalized_pairs],
    )


async def canonicalize_wiki_card_record(
    card: Dict[str, Any],
    *,
    concept_lookup: Optional[Dict[str, tuple[str, str]]] = None,
    question_lookup: Optional[Dict[str, tuple[str, str]]] = None,
    source: Optional[Source] = None,
) -> Dict[str, Any]:
    resolved_card = dict(card)

    if concept_lookup is None:
        concept_lookup = await get_concept_registry_lookup()
    if question_lookup is None:
        question_lookup = await get_question_registry_lookup()

    concept_ids, concept_names = _canonicalize_registry_pairs(
        display_values=_normalize_named_list(card.get("topics", []))
        + _normalize_named_list(card.get("methods", [])),
        current_ids=list(card.get("concept_ids", [])),
        current_names=list(card.get("concept_names", [])),
        registry_lookup=concept_lookup,
        default_builder=_default_concept_pair,
    )
    resolved_card["concept_ids"] = concept_ids
    resolved_card["concept_names"] = concept_names

    question_ids, question_names = _canonicalize_registry_pairs(
        display_values=_normalize_named_list(card.get("problems", [])),
        current_ids=list(card.get("question_ids", [])),
        current_names=list(card.get("question_names", [])),
        registry_lookup=question_lookup,
        default_builder=_default_question_pair,
    )
    resolved_card["question_ids"] = question_ids
    resolved_card["question_names"] = question_names

    resolved_card["paper_type"] = _normalize_paper_type(card.get("paper_type"))
    resolved_card["domains"] = _normalize_domains(card.get("domains"))
    resolved_card["short_title"] = (
        _clip_short_title(card.get("short_title"))
        or _build_short_title(
            _normalize_optional_string(card.get("title"))
            or _normalize_optional_string(card.get("canonical_title")),
            _normalize_named_list(card.get("topics", [])),
            _normalize_named_list(card.get("methods", [])),
        )
        or _normalize_optional_string(card.get("canonical_title"))
        or _normalize_optional_string(card.get("title"))
    )
    resolved_card["keywords"] = _normalize_named_list(card.get("keywords")) or _build_keywords(
        topics=_normalize_named_list(card.get("topics", [])),
        methods=_normalize_named_list(card.get("methods", [])),
        problems=_normalize_named_list(card.get("problems", [])),
        concept_names=concept_names,
    )
    resolved_card["core_concept_ids"] = _build_core_concept_ids(
        _normalize_named_list(card.get("core_concept_ids", []))
        + _normalize_named_list(card.get("topics", [])),
        concept_ids,
        concept_names,
    )
    resolved_card["moc_groups"] = _build_moc_groups(
        paper_type=resolved_card["paper_type"],
        domains=resolved_card["domains"],
        concept_ids=concept_ids,
        concept_names=concept_names,
        core_concept_ids=resolved_card["core_concept_ids"],
    )
    resolved_card["recommended_entry_points"] = _build_recommended_entry_points(
        core_concept_ids=resolved_card["core_concept_ids"],
        domains=resolved_card["domains"],
        raw_values=_normalize_string_list(card.get("recommended_entry_points")),
    )
    resolved_card["is_key_paper"] = _normalize_is_key_paper(
        card.get("is_key_paper"),
        paper_type=resolved_card["paper_type"],
        contributions=_normalize_string_list(card.get("contributions")),
        core_concept_ids=resolved_card["core_concept_ids"],
    )

    resolved_card = await enrich_wiki_card_quality_fields(
        resolved_card,
        source=source,
    )
    resolved_card.update(_render_obsidian_exports(resolved_card))
    return resolved_card


def _validate_wiki_card_payload_schema(payload: Dict[str, Any]) -> None:
    missing_fields = sorted(REQUIRED_WIKI_CARD_FIELDS - payload.keys())
    if missing_fields:
        raise ValueError(
            "Wiki card model output is missing required fields: "
            + ", ".join(missing_fields)
        )

    for field_name in WIKI_CARD_LIST_FIELDS:
        field_value = payload.get(field_name)
        if field_value is None:
            payload[field_name] = []
            continue
        if not isinstance(field_value, list):
            raise ValueError(
                f"Wiki card field '{field_name}' must be a list, got {type(field_value).__name__}"
            )

    if payload.get("is_key_paper") is None:
        payload["is_key_paper"] = False
    elif not isinstance(payload.get("is_key_paper"), bool):
        raise ValueError("Wiki card field 'is_key_paper' must be a boolean")

    related_sources = payload.get("related_sources")
    if related_sources is None:
        payload["related_sources"] = []
        return
    if not isinstance(related_sources, list):
        raise ValueError("Wiki card field 'related_sources' must be a list")
    for index, relation in enumerate(related_sources):
        if not isinstance(relation, dict):
            raise ValueError(
                f"Wiki card relation at index {index} must be an object, got {type(relation).__name__}"
            )


def _extract_json_object(raw_text: str) -> Dict[str, Any]:
    cleaned = clean_thinking_content(raw_text).strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            _validate_wiki_card_payload_schema(parsed)
            return parsed
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Wiki card model output did not contain a JSON object")

    candidate = cleaned[start : end + 1]
    parsed = json.loads(candidate)
    if not isinstance(parsed, dict):
        raise ValueError("Wiki card model output JSON must be an object")
    _validate_wiki_card_payload_schema(parsed)
    return parsed


def _relation_record_id(
    source_id: str,
    target_source_id: str,
    relation_type: str,
) -> str:
    source_token = source_id.replace(":", "-")
    target_token = target_source_id.replace(":", "-")
    return f"source_relation:{source_token}--{relation_type}--{target_token}"


def build_concept_registry_entries(card: Dict[str, Any]) -> List[Dict[str, Any]]:
    alias_map: Dict[str, List[str]] = {}
    concept_names = {
        normalize_record_id_string(str(concept_id)): concept_name
        for concept_id, concept_name in zip(
            card.get("concept_ids", []),
            card.get("concept_names", []),
        )
        if concept_id and concept_name
    }

    for value in card.get("topics", []) + card.get("methods", []) + list(
        concept_names.values()
    ):
        normalized = _normalize_wiki_label(value)
        if not normalized:
            continue
        lookup_key = _normalize_lookup_key(normalized)
        concept_ref = CANONICAL_CONCEPT_ALIASES.get(lookup_key)
        if concept_ref:
            concept_id, _ = concept_ref
        else:
            slug = _slugify_identifier(lookup_key)
            if not slug:
                continue
            concept_id = f"concept:{slug}"
        alias_map.setdefault(concept_id, []).append(normalized)

    entries: List[Dict[str, Any]] = []
    for concept_id in card.get("concept_ids", []):
        concept_id = normalize_record_id_string(str(concept_id))
        concept_name = concept_names.get(concept_id)
        if not concept_name:
            continue
        aliases = _normalize_alias_list(alias_map.get(concept_id, []) + [concept_name])
        entries.append({"id": concept_id, "name": concept_name, "aliases": aliases})
    return entries


def build_question_registry_entries(card: Dict[str, Any]) -> List[Dict[str, Any]]:
    alias_map: Dict[str, List[str]] = {}
    question_names = {
        normalize_record_id_string(str(question_id)): question_name
        for question_id, question_name in zip(
            card.get("question_ids", []),
            card.get("question_names", []),
        )
        if question_id and question_name
    }

    for value in card.get("problems", []) + list(question_names.values()):
        normalized = _normalize_wiki_label(value)
        if not normalized:
            continue
        lookup_key = _normalize_lookup_key(normalized)
        question_ref = CANONICAL_QUESTION_ALIASES.get(lookup_key)
        if question_ref:
            question_id, _ = question_ref
        else:
            slug = _slugify_identifier(lookup_key)
            if not slug:
                continue
            question_id = f"question:{slug}"
        alias_map.setdefault(question_id, []).append(normalized)

    entries: List[Dict[str, Any]] = []
    for question_id in card.get("question_ids", []):
        question_id = normalize_record_id_string(str(question_id))
        question_name = question_names.get(question_id)
        if not question_name:
            continue
        aliases = _normalize_alias_list(alias_map.get(question_id, []) + [question_name])
        entries.append({"id": question_id, "name": question_name, "aliases": aliases})
    return entries


def build_relation_entries(card: Dict[str, Any]) -> List[Dict[str, Any]]:
    source_id = str(card.get("source_id") or "").strip()
    if not source_id:
        return []

    source_title = _normalize_optional_string(card.get("source_title"))
    notebook_ids = [
        notebook_id
        for notebook_id in card.get("notebook_ids", [])
        if str(notebook_id).strip()
    ]
    wiki_card_id = _normalize_optional_string(card.get("id"))
    related_source_map = {
        relation["source_id"]: relation
        for relation in card.get("related_sources", [])
        if isinstance(relation, dict) and relation.get("source_id")
    }

    entries: List[Dict[str, Any]] = []
    for relation in card.get("relation_edges", []):
        if not isinstance(relation, dict):
            continue
        target_source_id = _normalize_optional_string(relation.get("source_id"))
        if not target_source_id:
            continue

        relation_type = _normalize_relation_type(relation.get("relation_type"))
        reason = _normalize_optional_string(relation.get("reason")) or "No reason provided."
        related_source = related_source_map.get(target_source_id, {})
        target_source_title = _normalize_optional_string(
            related_source.get("source_title")
        )

        entries.append(
            {
                "id": _relation_record_id(source_id, target_source_id, relation_type),
                "source_id": source_id,
                "source_title": source_title,
                "target_source_id": target_source_id,
                "target_source_title": target_source_title,
                "relation_type": relation_type,
                "reason": reason,
                "notebook_ids": notebook_ids,
                "wiki_card_id": wiki_card_id,
            }
        )

    return entries


async def sync_wiki_card_knowledge_registry(card: Dict[str, Any]) -> None:
    for concept_entry in build_concept_registry_entries(card):
        existing_rows = await repo_query(
            "SELECT * FROM $id",
            {"id": ensure_record_id(concept_entry["id"])},
        )
        existing_name = (
            _normalize_optional_string(existing_rows[0].get("name"))
            if existing_rows and isinstance(existing_rows[0], dict)
            else None
        )
        existing_aliases = (
            existing_rows[0].get("aliases", [])
            if existing_rows and isinstance(existing_rows[0], dict)
            else []
        )
        canonical_name, canonical_language = _choose_canonical_name(
            concept_entry["name"],
            list(existing_aliases) + list(concept_entry["aliases"]) + ([existing_name] if existing_name else []),
        )
        canonical_name = canonical_name or concept_entry["name"]
        await repo_upsert(
            "concept",
            concept_entry["id"],
            {
                "name": canonical_name,
                "aliases": _normalize_alias_list(
                    list(existing_aliases) + concept_entry["aliases"] + [canonical_name]
                ),
                "canonical_language": canonical_language,
            },
            add_timestamp=True,
        )

    for question_entry in build_question_registry_entries(card):
        existing_rows = await repo_query(
            "SELECT * FROM $id",
            {"id": ensure_record_id(question_entry["id"])},
        )
        existing_name = (
            _normalize_optional_string(existing_rows[0].get("name"))
            if existing_rows and isinstance(existing_rows[0], dict)
            else None
        )
        existing_aliases = (
            existing_rows[0].get("aliases", [])
            if existing_rows and isinstance(existing_rows[0], dict)
            else []
        )
        canonical_name, canonical_language = _choose_canonical_name(
            question_entry["name"],
            list(existing_aliases) + list(question_entry["aliases"]) + ([existing_name] if existing_name else []),
        )
        canonical_name = canonical_name or question_entry["name"]
        await repo_upsert(
            "question",
            question_entry["id"],
            {
                "name": canonical_name,
                "aliases": _normalize_alias_list(
                    list(existing_aliases) + question_entry["aliases"] + [canonical_name]
                ),
                "canonical_language": canonical_language,
            },
            add_timestamp=True,
        )

    wiki_card_id = _normalize_optional_string(card.get("id"))
    if wiki_card_id:
        await repo_query(
            "DELETE source_relation WHERE wiki_card_id = $wiki_card_id",
            {"wiki_card_id": ensure_record_id(wiki_card_id)},
        )

    for relation_entry in build_relation_entries(card):
        relation_record = SourceRelation(**relation_entry)
        await repo_upsert(
            SourceRelation.table_name,
            relation_entry["id"],
            relation_record._prepare_save_data(),
            add_timestamp=True,
        )


async def get_source_summary_record(source_id: str) -> Optional[Dict[str, Any]]:
    rows = await repo_query(
        """
        SELECT id, content, created, updated
        FROM source_insight
        WHERE source = $source_id
          AND (insight_type = $summary_title OR prompt_title = $summary_title)
        ORDER BY updated DESC
        LIMIT 1
        """,
        {
            "source_id": ensure_record_id(source_id),
            "summary_title": SOURCE_SUMMARY_TITLE,
        },
    )
    return rows[0] if rows else None


async def get_related_source_candidates(
    source: Source, notebook_ids: List[str], limit: int = 50
) -> List[Dict[str, str]]:
    candidates: Dict[str, Dict[str, str]] = {}

    for notebook_id in notebook_ids:
        rows = await repo_query(
            """
            SELECT id, title, updated
            FROM (SELECT VALUE in FROM reference WHERE out = $notebook_id)
            WHERE id != $source_id
            ORDER BY updated DESC
            LIMIT $limit
            """,
            {
                "notebook_id": ensure_record_id(notebook_id),
                "source_id": ensure_record_id(source.id),
                "limit": limit,
            },
        )
        for row in rows:
            source_id = str(row.get("id", "")).strip()
            title = str(row.get("title") or "").strip()
            if not source_id or source_id in candidates:
                continue
            candidates[source_id] = {"source_id": source_id, "title": title}
            if len(candidates) >= limit:
                break
        if len(candidates) >= limit:
            break

    return list(candidates.values())


def _apply_wiki_card_language_strategy(card: Dict[str, Any]) -> Dict[str, Any]:
    display_language = _detect_language(
        [
            card.get("title"),
            card.get("summary_text"),
            *card.get("topics", []),
            *card.get("methods", []),
            *card.get("problems", []),
        ]
    )
    canonical_language = _detect_language(
        [
            card.get("canonical_title"),
            *card.get("concept_names", []),
            *card.get("question_names", []),
        ]
    )

    return {
        "display_language": display_language,
        "canonical_language": canonical_language,
    }


def _shorten_excerpt(value: str, limit: int = 280) -> str:
    normalized = re.sub(r"\s+", " ", value).strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"


def _build_evidence_queries(card: Dict[str, Any]) -> List[str]:
    query_candidates = [
        card.get("title"),
        card.get("canonical_title"),
        *card.get("topics", []),
        *card.get("methods", []),
        *card.get("problems", []),
        *card.get("contributions", [])[:3],
        *card.get("limitations", [])[:2],
        *card.get("concept_names", []),
        *card.get("question_names", []),
    ]
    return _normalize_named_list(query_candidates)


def _score_embedding_against_queries(
    embedding: SourceEmbedding,
    queries: List[str],
) -> tuple[int, List[str]]:
    haystack = _normalize_lookup_key(
        f"{embedding.section or ''} {embedding.content or ''}"
    )
    if not haystack:
        return 0, []

    score = 0
    matches: List[str] = []
    for query in queries:
        normalized_query = _normalize_wiki_label(query)
        if not normalized_query:
            continue
        lookup_key = _normalize_lookup_key(normalized_query)
        if not lookup_key or lookup_key in PLACEHOLDER_LOOKUP_KEYS:
            continue

        if lookup_key in haystack:
            score += 5
            matches.append(normalized_query)
            continue

        token_hits = 0
        for token in lookup_key.split():
            if len(token) < 4 or token in PLACEHOLDER_LOOKUP_KEYS:
                continue
            if token in haystack:
                token_hits += 1

        if token_hits:
            score += min(3, token_hits)
            matches.append(normalized_query)

    return score, _dedupe_preserve_order(matches)


def _format_evidence_reason(matches: List[str], fallback: str) -> str:
    if matches:
        return "Matches: " + ", ".join(matches[:3])
    return fallback


async def _build_evidence_snippets(
    source: Source,
    card: Dict[str, Any],
    *,
    limit: int = 4,
) -> List[Dict[str, Any]]:
    embeddings = await source.get_embeddings(limit=24)
    if not embeddings:
        return []

    queries = _build_evidence_queries(card)
    scored_embeddings: List[tuple[int, List[str], SourceEmbedding]] = []
    for embedding in embeddings:
        score, matches = _score_embedding_against_queries(embedding, queries)
        scored_embeddings.append((score, matches, embedding))

    scored_embeddings.sort(
        key=lambda item: (
            item[0],
            len(item[1]),
            item[2].order if item[2].order is not None else -1,
        ),
        reverse=True,
    )

    snippets: List[Dict[str, Any]] = []
    selected = [item for item in scored_embeddings if item[0] > 0][:limit]
    if not selected:
        selected = scored_embeddings[: min(limit, len(scored_embeddings))]

    for score, matches, embedding in selected:
        if not embedding.id or not embedding.content:
            continue

        snippets.append(
            {
                "embedding_id": str(embedding.id),
                "section": embedding.section,
                "char_start": embedding.char_start,
                "char_end": embedding.char_end,
                "excerpt": _shorten_excerpt(embedding.content),
                "reason": _format_evidence_reason(
                    matches,
                    "Selected as a representative excerpt from the source evidence trail."
                    if score <= 0
                    else "Supports the extracted wiki-card structure.",
                ),
            }
        )

    return snippets


def _compute_extraction_confidence(
    card: Dict[str, Any],
    evidence_snippets: List[Dict[str, Any]],
) -> float:
    coverage_score = 0.0
    for field_name in WIKI_CARD_COVERAGE_FIELDS:
        value = card.get(field_name)
        if isinstance(value, list):
            coverage_score += 1.0 if value else 0.0
        elif _normalize_optional_string(value):
            coverage_score += 1.0

    coverage_ratio = coverage_score / len(WIKI_CARD_COVERAGE_FIELDS)
    evidence_ratio = min(1.0, len(evidence_snippets) / 4)
    summary_bonus = 0.08 if card.get("summary_source_insight_id") else 0.0
    relation_bonus = 0.04 if card.get("related_sources") else 0.0

    confidence = 0.28 + (coverage_ratio * 0.45) + (evidence_ratio * 0.15)
    confidence += summary_bonus + relation_bonus
    return round(min(0.98, max(0.2, confidence)), 2)


async def enrich_wiki_card_quality_fields(
    card: Dict[str, Any],
    *,
    source: Optional[Source] = None,
) -> Dict[str, Any]:
    enriched = dict(card)
    enriched.update(_apply_wiki_card_language_strategy(enriched))

    evidence_snippets = list(enriched.get("evidence_snippets", []) or [])
    if source and not evidence_snippets:
        evidence_snippets = await _build_evidence_snippets(source, enriched)
    enriched["evidence_snippets"] = evidence_snippets

    extraction_confidence = enriched.get("extraction_confidence")
    if extraction_confidence is None:
        extraction_confidence = _compute_extraction_confidence(
            enriched,
            evidence_snippets,
        )
    enriched["extraction_confidence"] = extraction_confidence
    return enriched


def render_obsidian_frontmatter(card: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": card.get("canonical_title") or card.get("title"),
        "display_title": card.get("title"),
        "short_title": card.get("short_title"),
        "slug": card.get("slug"),
        "source_id": card.get("source_id"),
        "wiki_card_id": card.get("id"),
        "summary_source_insight_id": card.get("summary_source_insight_id"),
        "status": card.get("status"),
        "display_language": card.get("display_language"),
        "canonical_language": card.get("canonical_language"),
        "extraction_confidence": card.get("extraction_confidence"),
        "authors": card.get("authors", []),
        "year": card.get("year"),
        "venue": card.get("venue"),
        "paper_type": card.get("paper_type"),
        "domains": card.get("domains", []),
        "topics": card.get("topics", []),
        "methods": card.get("methods", []),
        "problems": card.get("problems", []),
        "keywords": card.get("keywords", []),
        "moc_groups": card.get("moc_groups", []),
        "recommended_entry_points": card.get("recommended_entry_points", []),
        "is_key_paper": card.get("is_key_paper", False),
        "concept_ids": card.get("concept_ids", []),
        "concept_names": card.get("concept_names", []),
        "core_concept_ids": card.get("core_concept_ids", []),
        "question_ids": card.get("question_ids", []),
        "question_names": card.get("question_names", []),
        "evidence_snippets": card.get("evidence_snippets", []),
        "relation_edges": card.get("relation_edges", []),
        "notebook_ids": card.get("notebook_ids", []),
        "updated": card.get("updated"),
    }


def _dump_frontmatter_value(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        if not value:
            return "[]"
        if all(not isinstance(item, (dict, list)) for item in value):
            return "\n" + "\n".join(f"  - {json.dumps(item, ensure_ascii=False)}" for item in value)
        return "\n" + "\n".join(
            f"  - {json.dumps(item, ensure_ascii=False)}" for item in value
        )
    if isinstance(value, dict):
        if not value:
            return "{}"
        return "\n" + "\n".join(
            f"  {key}: {json.dumps(item, ensure_ascii=False)}"
            for key, item in value.items()
        )
    return json.dumps(value, ensure_ascii=False)


def render_obsidian_markdown(card: Dict[str, Any]) -> str:
    frontmatter = card.get("obsidian_frontmatter") or render_obsidian_frontmatter(card)
    frontmatter_lines = ["---"]
    for key, value in frontmatter.items():
        dumped = _dump_frontmatter_value(value)
        if dumped.startswith("\n"):
            frontmatter_lines.append(f"{key}:{dumped}")
        else:
            frontmatter_lines.append(f"{key}: {dumped}")
    frontmatter_lines.append("---")

    body: List[str] = [
        f"# {card.get('canonical_title') or card.get('title') or 'Untitled Source'}",
        "",
        "## Navigation Metadata",
        f"- Short title: {card.get('short_title') or card.get('canonical_title') or card.get('title') or 'Untitled Source'}",
        f"- Paper type: {card.get('paper_type') or 'Not stated in the source.'}",
        f"- Domains: {', '.join(card.get('domains', [])) if card.get('domains') else 'Not stated in the source.'}",
        f"- Is key paper: {'Yes' if card.get('is_key_paper') else 'No'}",
        "",
        "## Summary",
        card.get("summary_text") or "Not stated in the source.",
        "",
    ]

    sections = [
        ("Authors", card.get("authors", [])),
        ("Topics", card.get("topics", [])),
        ("Methods", card.get("methods", [])),
        ("Problems", card.get("problems", [])),
        ("Contributions", card.get("contributions", [])),
        ("Limitations", card.get("limitations", [])),
        ("Keywords", card.get("keywords", [])),
    ]
    for heading, items in sections:
        body.append(f"## {heading}")
        if items:
            body.extend(f"- {item}" for item in items)
        else:
            body.append("- Not stated in the source.")
        body.append("")

    body.extend(
        [
            "## Publication",
            f"- Venue: {card.get('venue') or 'Not stated in the source.'}",
            f"- Year: {card.get('year') if card.get('year') is not None else 'Not stated in the source.'}",
            f"- Display language: {card.get('display_language') or 'unknown'}",
            f"- Canonical language: {card.get('canonical_language') or 'unknown'}",
            f"- Extraction confidence: {card.get('extraction_confidence') if card.get('extraction_confidence') is not None else 'unknown'}",
            "",
            "## Navigation",
        ]
    )

    navigation_sections = [
        ("Core Concepts", card.get("core_concept_ids", [])),
        ("MOC Groups", card.get("moc_groups", [])),
        ("Recommended Entry Points", card.get("recommended_entry_points", [])),
    ]
    for heading, items in navigation_sections:
        body.append(f"### {heading}")
        if items:
            body.extend(f"- {item}" for item in items)
        else:
            body.append("- Not stated in the source.")
        body.append("")

    body.extend(
        [
            "## Related Sources",
        ]
    )

    related_sources = card.get("related_sources", [])
    if related_sources:
        for relation in related_sources:
            related_label = relation.get("source_title") or relation.get("source_id") or "Unknown source"
            relation_type = relation.get("relation_type") or "related_work"
            reason = relation.get("reason") or "No reason provided."
            body.append(f"- {related_label} ({relation_type}): {reason}")
    else:
        body.append("- No linked local sources.")

    body.extend(["", "## Evidence Snippets"])
    evidence_snippets = card.get("evidence_snippets", [])
    if evidence_snippets:
        for snippet in evidence_snippets:
            label_parts = [snippet.get("embedding_id") or "source_embedding:unknown"]
            if snippet.get("section"):
                label_parts.append(str(snippet["section"]))
            if (
                snippet.get("char_start") is not None
                and snippet.get("char_end") is not None
            ):
                label_parts.append(
                    f"chars {snippet['char_start']}-{snippet['char_end']}"
                )
            label = " | ".join(label_parts)
            body.append(f"- `{label}` {snippet.get('reason')}")
            body.append(f"  - {snippet.get('excerpt') or 'No excerpt available.'}")
    else:
        body.append("- No evidence snippets were selected.")

    return "\n".join(frontmatter_lines + [""] + body).strip()


def _render_obsidian_exports(card: Dict[str, Any]) -> Dict[str, Any]:
    frontmatter = render_obsidian_frontmatter(card)
    markdown = render_obsidian_markdown({**card, "obsidian_frontmatter": frontmatter})
    return {
        "obsidian_frontmatter": frontmatter,
        "obsidian_markdown": markdown,
    }


def normalize_wiki_card_payload(
    *,
    payload: Dict[str, Any],
    source: Source,
    notebook_ids: List[str],
    summary_record: Optional[Dict[str, Any]],
    related_source_candidates: List[Dict[str, str]],
    model_id: Optional[str],
    prompt_snapshot: str,
) -> Dict[str, Any]:
    candidate_map = {
        candidate["source_id"]: candidate for candidate in related_source_candidates
    }
    candidate_titles = {
        candidate["title"].strip().casefold(): candidate
        for candidate in related_source_candidates
        if candidate.get("title")
    }

    authors = _normalize_string_list(payload.get("authors"))
    topics = _normalize_named_list(payload.get("topics"))
    methods = _normalize_named_list(payload.get("methods"))
    problems = _normalize_named_list(payload.get("problems"))
    contributions = _normalize_string_list(payload.get("contributions"))
    limitations = _normalize_string_list(payload.get("limitations"))
    keywords = _normalize_named_list(payload.get("keywords"))

    title = _normalize_optional_string(payload.get("title")) or source.title or "Untitled Source"
    canonical_title = title
    short_title = (
        _clip_short_title(payload.get("short_title"))
        or _build_short_title(title, topics, methods)
        or canonical_title
    )
    summary_text = _normalize_optional_string(payload.get("summary_text"))
    venue = _normalize_optional_string(payload.get("venue"))
    paper_type = _normalize_paper_type(payload.get("paper_type"))
    domains = _normalize_domains(payload.get("domains"))

    related_sources: List[Dict[str, str]] = []
    for raw_relation in payload.get("related_sources") or []:
        if not isinstance(raw_relation, dict):
            continue

        matched_candidate = None
        source_id = _normalize_optional_string(raw_relation.get("source_id"))
        if source_id and source_id in candidate_map:
            matched_candidate = candidate_map[source_id]
        else:
            source_title = _normalize_optional_string(raw_relation.get("source_title"))
            if source_title:
                matched_candidate = candidate_titles.get(source_title.casefold())

        if not matched_candidate:
            continue

        related_sources.append(
            {
                "source_id": matched_candidate["source_id"],
                "source_title": matched_candidate.get("title", ""),
                "relation_type": _normalize_relation_type(
                    raw_relation.get("relation_type")
                ),
                "reason": _normalize_optional_string(raw_relation.get("reason"))
                or "No reason provided.",
            }
        )

    concept_ids, concept_names = _build_concept_fields(topics, methods)
    question_ids, question_names = _build_question_fields(problems)
    core_concept_ids = _build_core_concept_ids(
        _normalize_named_list(payload.get("core_concepts")),
        concept_ids,
        concept_names,
    )
    keywords = keywords or _build_keywords(
        topics=topics,
        methods=methods,
        problems=problems,
        concept_names=concept_names,
    )
    moc_groups = _build_moc_groups(
        paper_type=paper_type,
        domains=domains,
        concept_ids=concept_ids,
        concept_names=concept_names,
        core_concept_ids=core_concept_ids,
    )
    recommended_entry_points = _build_recommended_entry_points(
        core_concept_ids=core_concept_ids,
        domains=domains,
        raw_values=_normalize_string_list(payload.get("recommended_entry_points")),
    )
    is_key_paper = _normalize_is_key_paper(
        payload.get("is_key_paper"),
        paper_type=paper_type,
        contributions=contributions,
        core_concept_ids=core_concept_ids,
    )
    relation_edges = [
        {
            "source_id": relation["source_id"],
            "relation_type": relation["relation_type"],
            "reason": relation["reason"],
        }
        for relation in related_sources
    ]

    normalized = {
        "source_id": str(source.id),
        "notebook_ids": notebook_ids,
        "source_title": source.title,
        "title": title,
        "short_title": short_title,
        "canonical_title": canonical_title,
        "slug": _slugify(canonical_title),
        "authors": authors,
        "year": _normalize_year(payload.get("year")),
        "venue": venue,
        "paper_type": paper_type,
        "domains": domains,
        "summary_text": summary_text,
        "topics": topics,
        "methods": methods,
        "problems": problems,
        "contributions": contributions,
        "limitations": limitations,
        "keywords": keywords,
        "moc_groups": moc_groups,
        "recommended_entry_points": recommended_entry_points,
        "is_key_paper": is_key_paper,
        "concept_ids": concept_ids,
        "concept_names": concept_names,
        "core_concept_ids": core_concept_ids,
        "question_ids": question_ids,
        "question_names": question_names,
        "related_sources": related_sources,
        "relation_edges": relation_edges,
        "display_language": None,
        "canonical_language": None,
        "extraction_confidence": None,
        "evidence_snippets": [],
        "summary_source_insight_id": str(summary_record["id"]) if summary_record else None,
        "prompt_snapshot": prompt_snapshot,
        "model_id": model_id,
        "status": "completed",
        "error_message": None,
    }
    normalized.update(_render_obsidian_exports(normalized))
    return normalized


async def generate_wiki_card_payload(
    source: Source,
    model_id: Optional[str] = None,
) -> Dict[str, Any]:
    if not source.full_text or not source.full_text.strip():
        raise ValueError("Source has no content to extract a wiki card from")

    notebook_ids = await source.get_notebook_ids()
    related_source_candidates = await get_related_source_candidates(source, notebook_ids)
    summary_record = await get_source_summary_record(str(source.id))

    candidate_block = "\n".join(
        f"- {candidate['source_id']}: {candidate.get('title', '')}"
        for candidate in related_source_candidates
    ) or "- (none)"

    summary_block = summary_record.get("content", "").strip() if summary_record else ""
    summary_block = summary_block or "No canonical summary is available yet."

    payload_messages = [
        SystemMessage(content=SOURCE_WIKI_CARD_PROMPT),
        HumanMessage(
            content="\n\n".join(
                [
                    f"SOURCE_ID: {source.id}",
                    f"SOURCE_TITLE: {source.title or 'Untitled Source'}",
                    f"LOCAL_SOURCE_CANDIDATES:\n{candidate_block}",
                    f"CANONICAL_SUMMARY:\n{summary_block}",
                    f"SOURCE_TEXT:\n{source.full_text}",
                ]
            )
        ),
    ]

    chain = await provision_langchain_model(
        str(payload_messages),
        model_id,
        "transformation",
        max_tokens=4096,
    )
    response = await chain.ainvoke(payload_messages)
    response_content = extract_text_content(response.content)
    parsed = _extract_json_object(response_content)

    normalized = normalize_wiki_card_payload(
        payload=parsed,
        source=source,
        notebook_ids=notebook_ids,
        summary_record=summary_record,
        related_source_candidates=related_source_candidates,
        model_id=model_id,
        prompt_snapshot=SOURCE_WIKI_CARD_PROMPT,
    )
    return await canonicalize_wiki_card_record(normalized, source=source)


async def serialize_source_wiki_card(
    wiki_card: SourceWikiCard,
    *,
    concept_lookup: Optional[Dict[str, tuple[str, str]]] = None,
    question_lookup: Optional[Dict[str, tuple[str, str]]] = None,
) -> Dict[str, Any]:
    topics = _normalize_named_list(wiki_card.topics)
    methods = _normalize_named_list(wiki_card.methods)
    problems = _normalize_named_list(wiki_card.problems)
    concept_seed_values = topics + methods
    if not concept_seed_values:
        concept_seed_values = _normalize_named_list(wiki_card.concept_names)
    question_seed_values = problems
    if not question_seed_values:
        question_seed_values = _normalize_named_list(getattr(wiki_card, "question_names", []))

    concept_ids, concept_names = _build_concept_fields(concept_seed_values)
    question_ids, question_names = _build_question_fields(question_seed_values)

    serialized = {
        "id": str(wiki_card.id or ""),
        "source_id": str(wiki_card.source),
        "notebook_ids": wiki_card.notebook_ids,
        "source_title": wiki_card.source_title,
        "title": wiki_card.title,
        "short_title": wiki_card.short_title,
        "canonical_title": wiki_card.canonical_title,
        "slug": wiki_card.slug,
        "authors": wiki_card.authors,
        "year": wiki_card.year,
        "venue": wiki_card.venue,
        "paper_type": wiki_card.paper_type,
        "domains": wiki_card.domains,
        "summary_text": wiki_card.summary_text,
        "topics": topics,
        "methods": methods,
        "problems": problems,
        "contributions": wiki_card.contributions,
        "limitations": wiki_card.limitations,
        "keywords": wiki_card.keywords,
        "moc_groups": wiki_card.moc_groups,
        "recommended_entry_points": wiki_card.recommended_entry_points,
        "is_key_paper": wiki_card.is_key_paper,
        "concept_ids": concept_ids,
        "concept_names": concept_names,
        "core_concept_ids": wiki_card.core_concept_ids,
        "question_ids": question_ids,
        "question_names": question_names,
        "related_sources": wiki_card.related_sources,
        "relation_edges": wiki_card.relation_edges,
        "display_language": wiki_card.display_language,
        "canonical_language": wiki_card.canonical_language,
        "extraction_confidence": wiki_card.extraction_confidence,
        "evidence_snippets": wiki_card.evidence_snippets,
        "summary_source_insight_id": wiki_card.summary_source_insight_id,
        "prompt_snapshot": wiki_card.prompt_snapshot,
        "model_id": wiki_card.model_id,
        "command_id": wiki_card.command_id,
        "status": wiki_card.status,
        "error_message": wiki_card.error_message,
        "created": str(wiki_card.created or ""),
        "updated": str(wiki_card.updated or ""),
    }
    source = None
    if not wiki_card.evidence_snippets or wiki_card.extraction_confidence is None:
        try:
            source = await wiki_card.get_source()
        except Exception as exc:
            logger.debug(f"Could not load source for wiki card enrichment {wiki_card.id}: {exc}")

    return await canonicalize_wiki_card_record(
        serialized,
        concept_lookup=concept_lookup,
        question_lookup=question_lookup,
        source=source,
    )


async def set_wiki_card_status(
    wiki_card_id: str,
    *,
    status: str,
    command_id: Optional[str] = None,
    error_message: Optional[str] = None,
) -> Optional[SourceWikiCard]:
    if status not in WIKI_CARD_STATUS_VALUES:
        raise ValueError(f"Unsupported wiki card status: {status}")

    wiki_card = await SourceWikiCard.get(wiki_card_id)
    wiki_card.status = status  # type: ignore[assignment]
    wiki_card.error_message = error_message
    if command_id is not None:
        wiki_card.command_id = command_id
    await wiki_card.save()
    return wiki_card


async def upsert_pending_wiki_card(
    source: Source,
    *,
    existing: Optional[SourceWikiCard] = None,
) -> SourceWikiCard:
    notebook_ids = await source.get_notebook_ids()
    wiki_card = existing or SourceWikiCard(
        source=str(source.id),
        notebook_ids=notebook_ids,
    )
    wiki_card.notebook_ids = notebook_ids
    wiki_card.source_title = source.title
    wiki_card.title = wiki_card.title or source.title
    wiki_card.canonical_title = wiki_card.canonical_title or source.title
    wiki_card.slug = wiki_card.slug or _slugify(source.title or "untitled-source")
    wiki_card.display_language = None
    wiki_card.canonical_language = None
    wiki_card.extraction_confidence = None
    wiki_card.evidence_snippets = []
    wiki_card.status = "pending"
    wiki_card.error_message = None
    await wiki_card.save()
    logger.debug(f"Prepared pending wiki card {wiki_card.id} for source {source.id}")
    return wiki_card
