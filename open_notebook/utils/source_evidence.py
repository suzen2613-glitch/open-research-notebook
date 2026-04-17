from typing import Sequence

from open_notebook.domain.notebook import SourceEmbedding


def _clip_excerpt(text: str, max_chars: int = 280) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[: max_chars - 1].rstrip() + "..."


def format_source_evidence(
    embeddings: Sequence[SourceEmbedding], max_excerpt_chars: int = 280
) -> str:
    """Format embedded source chunks into a compact evidence appendix."""
    if not embeddings:
        return "No structured evidence excerpts are available for this source."

    parts = ["## SOURCE EVIDENCE"]
    for embedding in embeddings:
        evidence_id = embedding.id or "source_embedding:unknown"
        label_parts = [f"**Evidence ID:** {evidence_id}"]
        if embedding.section:
            label_parts.append(f"**Section:** {embedding.section}")
        if embedding.order is not None:
            label_parts.append(f"**Chunk:** {embedding.order + 1}")
        if embedding.char_start is not None and embedding.char_end is not None:
            label_parts.append(
                f"**Span:** chars {embedding.char_start}-{embedding.char_end}"
            )

        parts.append(" | ".join(label_parts))
        parts.append(f"**Excerpt:** {_clip_excerpt(embedding.content, max_excerpt_chars)}")
        parts.append("")

    return "\n".join(parts).strip()
