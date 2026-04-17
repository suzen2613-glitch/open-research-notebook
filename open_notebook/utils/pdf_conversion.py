from loguru import logger

from open_notebook.config import PDF_CONVERSION_AUTO_ORDER, PDF_CONVERSION_ENGINE
from open_notebook.utils.pdf_marker import convert_pdf_with_marker, is_marker_available
from open_notebook.utils.pdf_mineru_cloud import (
    convert_pdf_with_mineru_cloud,
    is_mineru_cloud_available,
)
from open_notebook.utils.pdf_mineru import convert_pdf_with_mineru, is_mineru_available


PDF_CONVERTERS = {
    "mineru_cloud": (is_mineru_cloud_available, convert_pdf_with_mineru_cloud),
    "marker": (is_marker_available, convert_pdf_with_marker),
    "mineru": (is_mineru_available, convert_pdf_with_mineru),
}


def get_pdf_engine_order(selected_engine: str | None = None) -> list[str]:
    engine = (selected_engine or PDF_CONVERSION_ENGINE or "auto").strip().lower()
    if engine != "auto":
        order = [engine]
        if engine == "mineru_cloud":
            order.extend(["mineru", "marker"])
        elif engine == "mineru":
            order.append("marker")
        deduped: list[str] = []
        for item in order:
            if item not in deduped:
                deduped.append(item)
        return deduped

    parsed = [
        item.strip().lower()
        for item in (PDF_CONVERSION_AUTO_ORDER or "").split(",")
        if item.strip()
    ]
    order = [item for item in parsed if item in PDF_CONVERTERS]
    for fallback in ("mineru_cloud", "mineru", "marker"):
        if fallback not in order:
            order.append(fallback)
    return order


def convert_pdf(
    file_path: str, source_id: str, selected_engine: str | None = None
) -> dict[str, str | None]:
    errors: list[str] = []
    requested_engine = (selected_engine or PDF_CONVERSION_ENGINE or "auto").strip().lower()

    for engine in get_pdf_engine_order(selected_engine):
        availability_check, converter = PDF_CONVERTERS.get(engine, (None, None))
        if availability_check is None or converter is None:
            errors.append(f"unsupported engine '{engine}'")
            continue

        if not availability_check():
            errors.append(f"{engine} unavailable")
            continue

        try:
            logger.info(f"Converting PDF with {engine}: {file_path}")
            return converter(file_path, source_id)
        except Exception as exc:
            logger.warning(f"PDF conversion with {engine} failed: {exc}")
            errors.append(f"{engine} failed: {exc}")

    raise RuntimeError("PDF conversion failed. " + " | ".join(errors))
