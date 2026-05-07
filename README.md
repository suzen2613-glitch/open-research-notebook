# Open Research Notebook

An agentic research workspace that turns a Zotero paper library into a structured, LLM-readable knowledge base.

This project is a research-focused fork of [Open Notebook](https://github.com/lfnovo/open-notebook). The current version extends the original Notebook LM-style workflow with academic paper ingestion, PDF conversion, structured Wiki Cards, evidence-grounded metadata, and an interactive knowledge graph for literature review.

## What It Does

Open Research Notebook is designed for researchers who need to read, organize, and synthesize large paper collections.

The system can:

- Import papers from Zotero collections and local PDF files.
- Parse PDFs into Markdown with text, sections, and image assets.
- Generate source summaries with LLM transformations.
- Extract structured Wiki Cards from academic papers.
- Build concept, question, domain, and paper-to-paper relation metadata.
- Preserve evidence snippets that connect extracted claims back to source chunks.
- Search and chat over selected sources and notes with RAG context.
- Visualize papers, concepts, and relations as an interactive knowledge graph.

## Version 2 Highlights

This version moves the project from a general notebook clone toward an agentic literature-review workspace.

### Zotero to Knowledge Base

- Batch import Zotero collections.
- Resolve Zotero PDF attachments from the local library.
- Skip or link existing papers by normalized title.
- Track long-running imports through the background command queue.

### Hybrid PDF Parsing

- Convert papers into normalized Markdown.
- Support local parsing engines and cloud API fallback.
- Keep generated image assets available through the API.
- Store parsed content as source records for downstream RAG and extraction.

### LLM Wiki Cards

Each academic source can be converted into a structured Wiki Card with fields such as:

- title, authors, year, venue, paper type
- domains, topics, methods, problems
- contributions and limitations
- core concepts and research questions
- recommended entry points
- related sources and relation types
- evidence snippets for grounding

### Four-Column Research Workspace

Notebook pages are organized around the research workflow:

- **Sources**: imported papers and processing status.
- **Summaries**: LLM-generated source summaries.
- **Wiki Cards**: structured paper metadata and research-positioning cards.
- **Notes**: human or AI-assisted research notes.

Academic notebooks use all four columns. General notebooks can be used as lighter note workspaces.

### Knowledge Graph Visualization

The new graph view uses React Flow to draw an interactive paper knowledge graph from completed Wiki Cards.

It supports:

- paper nodes and concept nodes
- source-to-source relation edges
- paper type and domain filters
- search and focus mode
- minimap, zoom, drag, and fit-to-view controls
- side panel inspection for selected papers or concepts

This is a visualization layer over extracted research metadata, not a freehand drawing canvas.

## Architecture

```text
Frontend (Next.js / React)
  - four-column notebook workspace
  - source, summary, wiki-card, notes UI
  - React Flow knowledge graph

FastAPI Backend
  - REST API
  - authentication middleware
  - model and credential management
  - source, note, chat, summary, wiki-card routes

Worker Queue
  - surreal-commands jobs
  - source processing
  - Zotero import
  - summary and Wiki Card generation

SurrealDB
  - notebooks, sources, notes
  - source embeddings
  - Wiki Cards
  - concepts, questions, source relations
```

## Tech Stack

- Python 3.11+
- FastAPI
- SurrealDB
- LangGraph
- Next.js / React / TypeScript
- TanStack Query
- React Flow
- Tailwind CSS
- Docker / Docker Compose
- Multi-provider LLM support through Open Notebook's provider layer

## Quick Start for Development

```bash
git clone https://github.com/suzen2613-glitch/open-research-notebook.git
cd open-research-notebook

cp .env.example .env
uv sync
cd frontend && npm install && cd ..
```

Set the required values in `.env`:

```bash
OPEN_NOTEBOOK_ENCRYPTION_KEY=replace-with-a-random-secret
OPEN_NOTEBOOK_PASSWORD=replace-with-a-login-password
SURREAL_PASSWORD=replace-with-a-database-password
```

Start the local stack:

```bash
make start-all
```

Default local services:

- Frontend: `http://localhost:3000`
- API: `http://localhost:5055`
- API docs: `http://localhost:5055/docs`
- SurrealDB: `127.0.0.1:8000`

## Docker Compose

For containerized deployment:

```bash
cp .env.example .env
# edit required secrets in .env
docker compose up -d
```

The compose file starts SurrealDB and the Open Notebook service. For development on this fork, source-based startup is recommended so local changes are reflected immediately.

## Core Workflows

### Import Papers

Use the UI Zotero import panel, REST API, or local scripts to import a collection into an academic notebook.

The import pipeline:

1. Reads the Zotero SQLite database.
2. Finds PDF attachments.
3. Converts each PDF to Markdown.
4. Creates or links source records.
5. Queues source processing and optional embeddings.

### Generate Structured Research Cards

After sources are processed, generate Wiki Cards for papers. The Wiki Card prompt extracts high-signal metadata for later navigation, retrieval, and graph visualization.

### Explore the Knowledge Graph

Open the Knowledge Graph from a notebook header after Wiki Cards are generated. The graph is built from completed cards, concept fields, and relation edges.

## API Surface

The backend exposes REST endpoints for:

- notebooks
- sources
- summaries
- Wiki Cards
- notes
- chat and source chat
- search and ask
- credentials and model registry
- Zotero import jobs
- background command status

Run the API and open `http://localhost:5055/docs` for the generated OpenAPI documentation.

## Repository Notes

This repository keeps the original Open Notebook foundation while adding research-agent features on top. The main additions in this version include:

- academic notebook mode
- Zotero import workflow
- PDF parsing fallback configuration
- Wiki Card extraction and registry synchronization
- source relation and evidence metadata
- knowledge graph visualization
- frontend component decomposition for larger feature panels
- local service scripts for API, worker, frontend, and SurrealDB

## Project Positioning

Open Research Notebook is intended as an AI research assistant for literature review:

- use RAG for grounded question answering
- use LLM extraction for structured paper understanding
- use graph metadata for cross-paper navigation
- use notes as the workspace for synthesis and writing

It is especially useful for turning a large personal Zotero library into an agent-readable research memory.

## Attribution

This project is built on top of [Open Notebook](https://github.com/lfnovo/open-notebook), an open-source, privacy-focused alternative to Google NotebookLM. The original project is licensed under MIT. This fork keeps the same spirit of self-hosted, provider-flexible research tooling while focusing on academic literature workflows.

## License

MIT. See [LICENSE](LICENSE).
