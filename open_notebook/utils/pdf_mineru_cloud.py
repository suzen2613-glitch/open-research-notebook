import io
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any, Optional

import httpx
import requests
from loguru import logger

from open_notebook.config import (
    MINERU_CLOUD_API_BASE_URL,
    MINERU_CLOUD_API_TOKEN,
    MINERU_CLOUD_ENABLE_FORMULA,
    MINERU_CLOUD_ENABLE_OCR,
    MINERU_CLOUD_ENABLE_TABLE,
    MINERU_CLOUD_LANGUAGE,
    MINERU_CLOUD_MODEL_VERSION,
    MINERU_CLOUD_POLL_INTERVAL_SECONDS,
    MINERU_CLOUD_TIMEOUT_SECONDS,
)
from open_notebook.utils.pdf_assets import (
    copy_markdown_image_assets,
    rewrite_markdown_image_urls,
    source_image_slug,
)


def is_mineru_cloud_available() -> bool:
    return bool(MINERU_CLOUD_API_TOKEN)


def _auth_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {MINERU_CLOUD_API_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _build_apply_payload(pdf_path: Path, source_id: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "enable_formula": MINERU_CLOUD_ENABLE_FORMULA,
        "enable_table": MINERU_CLOUD_ENABLE_TABLE,
        "files": [
            {
                "name": pdf_path.name,
                "is_ocr": MINERU_CLOUD_ENABLE_OCR,
                "data_id": source_image_slug(source_id),
            }
        ],
    }
    if MINERU_CLOUD_MODEL_VERSION:
        payload["model_version"] = MINERU_CLOUD_MODEL_VERSION
    if MINERU_CLOUD_LANGUAGE:
        payload["language"] = MINERU_CLOUD_LANGUAGE
    return payload


def _parse_apply_response(payload: dict[str, Any]) -> tuple[str, str]:
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("msg") or "MinerU Cloud API apply request failed")

    data = payload.get("data") or {}
    batch_id = data.get("batch_id")
    file_urls = data.get("file_urls") or []
    upload_url = None
    if file_urls:
        first_entry = file_urls[0]
        if isinstance(first_entry, str):
            upload_url = first_entry
        elif isinstance(first_entry, dict):
            upload_url = (
                first_entry.get("file_url")
                or first_entry.get("upload_url")
                or first_entry.get("url")
            )

    if not batch_id or not upload_url:
        raise RuntimeError("MinerU Cloud API returned an incomplete upload response")

    return str(batch_id), str(upload_url)


def _parse_batch_result(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("code") != 0:
        raise RuntimeError(payload.get("msg") or "MinerU Cloud API batch request failed")

    data = payload.get("data") or {}
    extract_result = data.get("extract_result") or []
    if not extract_result:
        return {"state": data.get("state") or data.get("status") or "processing"}

    result = extract_result[0]
    state = (result.get("state") or "").strip().lower()
    if state in {"failed", "error"}:
        raise RuntimeError(result.get("err_msg") or result.get("message") or "MinerU Cloud extraction failed")
    return result


def _find_markdown_file(output_dir: Path, pdf_stem: str) -> Optional[Path]:
    candidates = sorted(output_dir.rglob("*.md"))
    if not candidates:
        return None

    for preferred_name in ("full.md", f"{pdf_stem}.md"):
        for candidate in candidates:
            if candidate.name == preferred_name:
                return candidate

    for candidate in candidates:
        if candidate.stem == pdf_stem:
            return candidate

    return candidates[0]


def _download_result_archive(client: httpx.Client, result: dict[str, Any]) -> bytes:
    zip_url = result.get("full_zip_url") or result.get("result_zip_url")
    if not zip_url:
        raise RuntimeError("MinerU Cloud API did not return a downloadable ZIP result")

    response = requests.get(
        str(zip_url),
        timeout=max(MINERU_CLOUD_TIMEOUT_SECONDS, 60),
    )
    response.raise_for_status()
    return response.content


def convert_pdf_with_mineru_cloud(
    file_path: str, source_id: str
) -> dict[str, Optional[str]]:
    """
    Convert a PDF to markdown using the official MinerU Cloud API.
    """
    if not is_mineru_cloud_available():
        raise RuntimeError(
            "MinerU Cloud API token is not configured. Set MINERU_CLOUD_API_TOKEN before using this engine."
        )

    pdf_path = Path(file_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    timeout = httpx.Timeout(
        connect=30.0,
        read=float(MINERU_CLOUD_TIMEOUT_SECONDS),
        write=60.0,
        pool=30.0,
    )
    with httpx.Client(timeout=timeout) as client:
        apply_response = client.post(
            f"{MINERU_CLOUD_API_BASE_URL}/api/v4/file-urls/batch",
            headers=_auth_headers(),
            json=_build_apply_payload(pdf_path, source_id),
        )
        apply_response.raise_for_status()
        batch_id, upload_url = _parse_apply_response(apply_response.json())

        with pdf_path.open("rb") as file_handle:
            upload_response = requests.put(
                upload_url,
                data=file_handle,
                timeout=max(MINERU_CLOUD_TIMEOUT_SECONDS, 60),
            )
        upload_response.raise_for_status()

        poll_url = f"{MINERU_CLOUD_API_BASE_URL}/api/v4/extract-results/batch/{batch_id}"
        deadline = time.monotonic() + max(MINERU_CLOUD_TIMEOUT_SECONDS, 30)
        last_state = "queued"
        while time.monotonic() < deadline:
            result_response = client.get(poll_url, headers=_auth_headers())
            result_response.raise_for_status()
            result = _parse_batch_result(result_response.json())
            state = (result.get("state") or "").strip().lower()
            if state != last_state:
                logger.info(
                    "MinerU Cloud API batch {} state changed: {} -> {}",
                    batch_id,
                    last_state,
                    state,
                )
                last_state = state

            if state == "done":
                archive_bytes = _download_result_archive(client, result)
                break

            time.sleep(max(MINERU_CLOUD_POLL_INTERVAL_SECONDS, 1))
        else:
            raise RuntimeError("MinerU Cloud API conversion timed out while waiting for extraction to finish")

    with tempfile.TemporaryDirectory(prefix="open-notebook-mineru-cloud-") as temp_dir:
        extract_dir = Path(temp_dir) / "output"
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            archive.extractall(extract_dir)

        markdown_path = _find_markdown_file(extract_dir, pdf_path.stem)
        if not markdown_path:
            raise RuntimeError(
                "MinerU Cloud API conversion finished without a markdown file in the result archive"
            )

        markdown = markdown_path.read_text(encoding="utf-8")
        copy_markdown_image_assets(markdown, markdown_path.parent, source_id)
        markdown = rewrite_markdown_image_urls(markdown, source_image_slug(source_id))

    return {
        "content": markdown,
        "title": pdf_path.stem,
        "file_path": str(pdf_path),
        "url": None,
    }
