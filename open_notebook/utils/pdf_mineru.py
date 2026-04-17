import shlex
import shutil
import subprocess
import tempfile
import os
from pathlib import Path
from typing import Optional

from open_notebook.config import (
    MINERU_COMMAND,
    MINERU_EXTRA_ARGS,
    MINERU_TIMEOUT_SECONDS,
)
from open_notebook.utils.pdf_assets import (
    copy_markdown_image_assets,
    rewrite_markdown_image_urls,
    source_image_slug,
)


def is_mineru_available() -> bool:
    command = shlex.split(MINERU_COMMAND)
    if not command:
        return False
    return shutil.which(command[0]) is not None


def _has_usable_nvidia_gpu() -> bool:
    return _pick_mineru_device() is not None


def _pick_mineru_device() -> Optional[str]:
    """Pick the CUDA device with the most free VRAM if it's safe to use."""
    if shutil.which("nvidia-smi") is None:
        return None

    result = subprocess.run(
        [
            "nvidia-smi",
            "--query-gpu=index,memory.free",
            "--format=csv,noheader,nounits",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode != 0:
        return None

    best_index: Optional[str] = None
    best_free_mib = -1
    for line in result.stdout.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 2:
            continue

        index, free_mib_str = parts
        try:
            free_mib = int(free_mib_str)
        except ValueError:
            continue

        if free_mib > best_free_mib:
            best_index = index
            best_free_mib = free_mib

    # Keep MinerU on CPU if no GPU has enough headroom for local inference.
    if best_index is None or best_free_mib < 6000:
        return None

    return f"cuda:{best_index}"


def _build_mineru_command(pdf_path: Path, output_dir: Path) -> list[str]:
    command = shlex.split(MINERU_COMMAND)
    command.extend(["-p", str(pdf_path), "-o", str(output_dir)])

    if MINERU_EXTRA_ARGS.strip():
        command.extend(shlex.split(MINERU_EXTRA_ARGS))
    else:
        # Default to CPU for predictable performance on mixed-use machines.
        command.extend(["-b", "pipeline", "-d", "cpu"])

    return command


def _find_markdown_file(output_dir: Path, pdf_stem: str) -> Optional[Path]:
    candidates = sorted(output_dir.rglob("*.md"))
    if not candidates:
        return None

    exact_name = f"{pdf_stem}.md"
    for candidate in candidates:
        if candidate.name == exact_name:
            return candidate

    for candidate in candidates:
        if candidate.stem == pdf_stem:
            return candidate

    return candidates[0]


def convert_pdf_with_mineru(file_path: str, source_id: str) -> dict[str, Optional[str]]:
    """
    Convert a PDF to markdown using the MinerU CLI and publish extracted images.
    """
    if not is_mineru_available():
        raise RuntimeError(
            "MinerU is not available in the runtime environment. "
            "Install MinerU and ensure the CLI is on PATH before using this engine."
        )

    pdf_path = Path(file_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    with tempfile.TemporaryDirectory(prefix="open-notebook-mineru-") as temp_dir:
        output_dir = Path(temp_dir) / "output"
        output_dir.mkdir(parents=True, exist_ok=True)

        command = _build_mineru_command(pdf_path, output_dir)
        env = os.environ.copy()
        vendor_path = (
            Path(__file__).resolve().parents[1] / "_vendor" / "mineru_sitecustomize"
        )
        existing_pythonpath = env.get("PYTHONPATH")
        env["PYTHONPATH"] = (
            f"{vendor_path}:{existing_pythonpath}"
            if existing_pythonpath
            else str(vendor_path)
        )
        env["OPEN_NOTEBOOK_MINERU_DISABLE_MULTIPROCESS"] = "1"

        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=MINERU_TIMEOUT_SECONDS,
            env=env,
        )
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            stdout = (result.stdout or "").strip()
            details = stderr or stdout or "unknown MinerU error"
            raise RuntimeError(f"MinerU conversion failed: {details[-500:]}")

        markdown_path = _find_markdown_file(output_dir, pdf_path.stem)
        if not markdown_path:
            raise RuntimeError(
                "MinerU conversion finished without generating a markdown file"
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
