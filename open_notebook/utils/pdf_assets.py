import re
import shutil
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from open_notebook.config import IMAGES_FOLDER, IMAGE_SERVER_URL


IMAGE_PATTERN = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")


def source_image_slug(source_id: str) -> str:
    """Convert a source ID into a filesystem-safe folder name."""
    return source_id.replace(":", "_").replace("/", "_")


def normalize_asset_path(asset_path: str) -> PurePosixPath:
    raw = asset_path.strip().strip("<>").replace("\\", "/")
    clean_parts = [
        part for part in PurePosixPath(raw).parts if part not in ("", ".", "..")
    ]
    return PurePosixPath(*clean_parts)


def is_local_asset_path(asset_path: str) -> bool:
    return not asset_path.startswith(("http://", "https://", "data:"))


def prepare_source_image_dir(source_id: str) -> Path:
    image_dir = Path(IMAGES_FOLDER) / source_image_slug(source_id)
    if image_dir.exists():
        shutil.rmtree(image_dir, ignore_errors=True)
    image_dir.mkdir(parents=True, exist_ok=True)
    return image_dir


def rewrite_markdown_image_urls(md_text: str, image_slug: str) -> str:
    """Rewrite local markdown image references to the local image server."""

    def replace_image(match: re.Match[str]) -> str:
        alt_text = match.group(1)
        img_path_str = match.group(2)

        if not is_local_asset_path(img_path_str):
            return match.group(0)

        normalized = normalize_asset_path(img_path_str).as_posix()
        if not normalized:
            return match.group(0)

        url = f"{IMAGE_SERVER_URL}/{image_slug}/{quote(normalized, safe='/._-')}"
        return f"![{alt_text}]({url})"

    return IMAGE_PATTERN.sub(replace_image, md_text)


def copy_markdown_image_assets(md_text: str, markdown_dir: Path, source_id: str) -> None:
    """Copy local markdown image assets into the shared static image folder."""
    image_dir = prepare_source_image_dir(source_id)

    for match in IMAGE_PATTERN.finditer(md_text):
        img_path_str = match.group(2)
        if not is_local_asset_path(img_path_str):
            continue

        rel_path = normalize_asset_path(img_path_str)
        if not rel_path.parts:
            continue

        src_path = (markdown_dir / rel_path).resolve()
        if not src_path.exists() or not src_path.is_file():
            continue

        dest_path = image_dir / Path(*rel_path.parts)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_path, dest_path)


def cleanup_source_images(source_id: str | None) -> None:
    """Delete extracted PDF images for a source if present."""
    if not source_id:
        return

    image_dir = Path(IMAGES_FOLDER) / source_image_slug(source_id)
    if image_dir.exists():
        shutil.rmtree(image_dir, ignore_errors=True)
