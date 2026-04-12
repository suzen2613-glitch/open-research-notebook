from importlib.util import find_spec
from pathlib import Path
from typing import Optional

from open_notebook.utils.pdf_assets import (
    cleanup_source_images,
    normalize_asset_path,
    prepare_source_image_dir,
    rewrite_markdown_image_urls,
    source_image_slug,
)


def is_marker_available() -> bool:
    return find_spec("marker") is not None


def convert_pdf_with_marker(file_path: str, source_id: str) -> dict[str, Optional[str]]:
    """
    Convert a PDF to markdown using Marker and save extracted images for static serving.

    Returns a dict with the fields expected by the source ingestion pipeline.
    """
    try:
        from marker.converters.pdf import PdfConverter
        from marker.models import create_model_dict
    except ImportError as exc:
        raise RuntimeError(
            "Marker is not installed in the runtime environment. "
            "Install the Marker dependencies before uploading PDFs."
        ) from exc

    pdf_path = Path(file_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    converter = PdfConverter(artifact_dict=create_model_dict())
    rendered = converter(str(pdf_path))

    image_slug = source_image_slug(source_id)
    image_dir = prepare_source_image_dir(source_id)

    for name, image in rendered.images.items():
        rel_path = normalize_asset_path(name)
        dest_path = image_dir / Path(*rel_path.parts)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(str(dest_path))

    markdown = rewrite_markdown_image_urls(rendered.markdown, image_slug)

    return {
        "content": markdown,
        "title": pdf_path.stem,
        "file_path": str(pdf_path),
        "url": None,
    }


def cleanup_marker_images(source_id: Optional[str]) -> None:
    """Delete extracted Marker images for a source if present."""
    cleanup_source_images(source_id)
