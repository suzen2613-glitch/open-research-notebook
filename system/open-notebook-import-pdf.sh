#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/config.sh"
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <pdf_path> [title] [notebook_id]"
  exit 1
fi
pdf_path="$1"
title="${2:-$(basename "$pdf_path" .pdf)}"
notebook_ids='[]'
if [[ $# -ge 3 && -n "${3:-}" ]]; then
  notebook_ids="[\"$3\"]"
fi
cd "$PROJECT_DIR"
export PDF_PATH="$pdf_path" TITLE="$title" NOTEBOOK_IDS="$notebook_ids"
"$CONDA_PYTHON" - <<'PY'
import json, os, asyncio
from pathlib import Path
from open_notebook.integrations.zotero_import import convert_pdf_with_marker
from api.models import SourceCreate
from api.routers.sources import create_source_json

pdf_path = Path(os.environ['PDF_PATH'])
title = os.environ['TITLE']
notebooks = json.loads(os.environ['NOTEBOOK_IDS'])
md_text, _ = convert_pdf_with_marker(pdf_path)
payload = SourceCreate(type='text', title=title, content=md_text, notebooks=notebooks, embed=True, async_processing=True)
resp = asyncio.run(create_source_json(payload))
print(json.dumps({'source_id': str(resp.id), 'title': title}, ensure_ascii=False))
PY
