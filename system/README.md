# Open Notebook system scripts

## Recommended: systemd user services

```bash
# Install units into ~/.config/systemd/user
bash system/open-notebook-service.sh install

# Enable auto-start on login and start the stack now
bash system/open-notebook-service.sh enable
bash system/open-notebook-service.sh start

# One-shot bootstrap
bash system/open-notebook-service.sh bootstrap

# Check status / logs
bash system/open-notebook-service.sh status
bash system/open-notebook-service.sh logs api
bash system/open-notebook-service.sh logs worker 200
```

Notes:
- This is the recommended local guard/auto-restart setup.
- Services are grouped under `open-notebook.target`.
- Images are served through the main API at `/api/images/...`; there is no required standalone `8888` image server anymore.
- Browser login now uses an auth cookie, so protected images can render without leaving `/api/images` publicly unauthenticated.
- `enable` makes the stack start on user login.
- To keep services alive after logout, also run `sudo loginctl enable-linger $USER`.

## Public Access Notes

- Set `OPEN_NOTEBOOK_PASSWORD` in the project `.env` before exposing the stack outside localhost.
- The frontend now defaults to same-origin `/api/*` proxying, which is the safer option for browser access.
- Expose port `3000` for the web UI.
- Expose port `5055` only if external machines need to call the REST API directly.
- If browser clients will call `5055` directly, set `OPEN_NOTEBOOK_CORS_ORIGINS` explicitly.

## Start
```bash
bash system/open-notebook-up.sh
```

## Stop
```bash
bash system/open-notebook-down.sh
```

## Status
```bash
bash system/open-notebook-status.sh
```

## Import Zotero collection
```bash
bash system/open-notebook-import-zotero.sh <collection_id> [notebook_id]
```

## Import single PDF
```bash
bash system/open-notebook-import-pdf.sh <pdf_path> [title] [notebook_id]
```

Notes:
- Marker conversion is task-based, not a long-running service.
- If `systemd` units are installed, `open-notebook-up.sh`, `down.sh`, and `status.sh` automatically delegate to them.
- If old manually started services are still running, stop once with `open-notebook-down.sh` before switching to `systemd`.
