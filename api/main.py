# Load environment variables
import os
from urllib.parse import urlsplit

from dotenv import load_dotenv

load_dotenv()

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from loguru import logger
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from api.auth import PasswordAuthMiddleware
from open_notebook.config import IMAGES_FOLDER
from open_notebook.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ExternalServiceError,
    InvalidInputError,
    NetworkError,
    NotFoundError,
    OpenNotebookError,
    RateLimitError,
)
from api.routers import (
    auth,
    chat,
    config,
    context,
    credentials,
    embedding,
    embedding_rebuild,
    episode_profiles,
    insights,
    languages,
    models,
    notebooks,
    notes,
    podcasts,
    search,
    settings,
    source_chat,
    source_embeddings,
    summaries,
    sources,
    speaker_profiles,
    transformations,
    wiki_cards,
    zotero,
)
from api.routers import commands as commands_router
from open_notebook.database.async_migrate import AsyncMigrationManager
from open_notebook.utils.encryption import get_secret_from_env

# Import commands to register them in the API process
try:
    logger.info("Commands imported in API process")
except Exception as e:
    logger.error(f"Failed to import commands in API process: {e}")


def _normalize_origin(value: str | None) -> str | None:
    if not value:
        return None

    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None

    return f"{parsed.scheme}://{parsed.netloc}"


def _request_host(request: Request) -> str | None:
    forwarded_host = request.headers.get("x-forwarded-host")
    host = forwarded_host or request.headers.get("host")
    if not host:
        return None
    return host.split(",")[0].strip().split(":")[0].lower()


def _is_same_host_origin(request: Request, origin: str | None) -> bool:
    normalized_origin = _normalize_origin(origin)
    if not normalized_origin:
        return False

    origin_host = urlsplit(normalized_origin).hostname
    request_host = _request_host(request)
    return bool(origin_host and request_host and origin_host.lower() == request_host)


def _default_cors_origins() -> list[str]:
    origins = {
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5055",
        "http://127.0.0.1:5055",
    }
    api_url_origin = _normalize_origin(
        os.getenv("API_URL") or os.getenv("NEXT_PUBLIC_API_URL")
    )
    if api_url_origin:
        origins.add(api_url_origin)
    return sorted(origins)


def _configured_cors_origins() -> list[str]:
    raw = os.getenv("OPEN_NOTEBOOK_CORS_ORIGINS")
    if raw is None:
        return _default_cors_origins()

    configured = {
        normalized
        for item in raw.split(",")
        if (normalized := _normalize_origin(item)) is not None
    }
    return sorted(configured)


CORS_ALLOWED_ORIGINS = _configured_cors_origins()
CORS_ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS"
DEFAULT_CORS_ALLOWED_HEADERS = "Authorization,Content-Type"


def _is_allowed_cors_origin(request: Request, origin: str | None) -> bool:
    if not origin:
        return False
    return origin in CORS_ALLOWED_ORIGINS or _is_same_host_origin(request, origin)


def _allowed_request_headers(request: Request) -> str:
    requested_headers = request.headers.get("access-control-request-headers")
    if requested_headers:
        return requested_headers
    return DEFAULT_CORS_ALLOWED_HEADERS


class OpenNotebookCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if (
            request.method == "OPTIONS"
            and request.headers.get("origin")
            and request.headers.get("access-control-request-method")
        ):
            headers = _cors_headers(request)
            if not headers:
                return Response(status_code=403)
            headers["Access-Control-Max-Age"] = "600"
            headers["Vary"] = "Origin"
            return Response(status_code=204, headers=headers)

        response = await call_next(request)
        headers = _cors_headers(request)
        if headers:
            for key, value in headers.items():
                response.headers.setdefault(key, value)
            response.headers.setdefault("Vary", "Origin")
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan event handler for the FastAPI application.
    Runs database migrations automatically on startup.
    """
    # Startup: Security checks
    logger.info("Starting API initialization...")

    # Security check: Encryption key
    if not get_secret_from_env("OPEN_NOTEBOOK_ENCRYPTION_KEY"):
        logger.warning(
            "OPEN_NOTEBOOK_ENCRYPTION_KEY not set. "
            "API key encryption will fail until this is configured. "
            "Set OPEN_NOTEBOOK_ENCRYPTION_KEY to any secret string."
        )
    if get_secret_from_env("OPEN_NOTEBOOK_PASSWORD"):
        logger.info("Password authentication is enabled.")
    else:
        logger.warning(
            "OPEN_NOTEBOOK_PASSWORD not set. API authentication is disabled."
        )
    logger.info(
        "Allowed CORS origins: "
        f"{', '.join(CORS_ALLOWED_ORIGINS) or '(none)'}"
        " + same-host browser origins"
    )

    # Run database migrations

    if os.getenv("OPEN_NOTEBOOK_SKIP_STARTUP_MIGRATIONS") == "1":
        logger.warning("Skipping startup database migrations by configuration.")
    else:
        try:
            migration_manager = AsyncMigrationManager()
            current_version = await migration_manager.get_current_version()
            logger.info(f"Current database version: {current_version}")

            if await migration_manager.needs_migration():
                logger.warning("Database migrations are pending. Running migrations...")
                await migration_manager.run_migration_up()
                new_version = await migration_manager.get_current_version()
                logger.success(
                    f"Migrations completed successfully. Database is now at version {new_version}"
                )
            else:
                logger.info(
                    "Database is already at the latest version. No migrations needed."
                )
        except Exception as e:
            logger.error(f"CRITICAL: Database migration failed: {str(e)}")
            logger.exception(e)
            # Fail fast - don't start the API with an outdated database schema
            raise RuntimeError(f"Failed to run database migrations: {str(e)}") from e

    # Run podcast profile data migration (legacy strings -> Model registry)
    try:
        from open_notebook.podcasts.migration import migrate_podcast_profiles

        await migrate_podcast_profiles()
    except Exception as e:
        logger.warning(f"Podcast profile migration encountered errors: {e}")
        # Non-fatal: profiles can be migrated manually via UI

    logger.success("API initialization completed successfully")

    # Yield control to the application
    yield

    # Shutdown: cleanup if needed
    logger.info("API shutdown complete")


app = FastAPI(
    title="Open Research Notebook API",
    description="API for Open Research Notebook - Research Assistant",
    lifespan=lifespan,
)

# Add password authentication middleware first
# Exclude auth bootstrap endpoints and public health/config routes
app.add_middleware(
    PasswordAuthMiddleware,
    excluded_paths=[
        "/",
        "/health",
        "/api/auth/status",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/config",
    ],
)

# Add CORS middleware last (so it processes first)
app.add_middleware(OpenNotebookCORSMiddleware)


# Custom exception handler to ensure CORS headers are included in error responses
# This helps when errors occur before the CORS middleware can process them
@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException):
    """
    Custom exception handler that ensures CORS headers are included in error responses.
    This is particularly important for 413 (Payload Too Large) errors during file uploads.

    Note: If a reverse proxy (nginx, traefik) returns 413 before the request reaches
    FastAPI, this handler won't be called. In that case, configure your reverse proxy
    to add CORS headers to error responses.
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={
            **(exc.headers or {}),
            **_cors_headers(request),
        },
    )


def _cors_headers(request: Request) -> dict[str, str]:
    origin = request.headers.get("origin")
    if not _is_allowed_cors_origin(request, origin):
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": CORS_ALLOWED_METHODS,
        "Access-Control-Allow-Headers": _allowed_request_headers(request),
    }


@app.exception_handler(NotFoundError)
async def not_found_error_handler(request: Request, exc: NotFoundError):
    return JSONResponse(
        status_code=404,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(InvalidInputError)
async def invalid_input_error_handler(request: Request, exc: InvalidInputError):
    return JSONResponse(
        status_code=400,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(AuthenticationError)
async def authentication_error_handler(request: Request, exc: AuthenticationError):
    return JSONResponse(
        status_code=401,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(RateLimitError)
async def rate_limit_error_handler(request: Request, exc: RateLimitError):
    return JSONResponse(
        status_code=429,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(ConfigurationError)
async def configuration_error_handler(request: Request, exc: ConfigurationError):
    return JSONResponse(
        status_code=422,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(NetworkError)
async def network_error_handler(request: Request, exc: NetworkError):
    return JSONResponse(
        status_code=502,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(ExternalServiceError)
async def external_service_error_handler(request: Request, exc: ExternalServiceError):
    return JSONResponse(
        status_code=502,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(OpenNotebookError)
async def open_notebook_error_handler(request: Request, exc: OpenNotebookError):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


# Include routers
app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(config.router, prefix="/api", tags=["config"])
app.include_router(notebooks.router, prefix="/api", tags=["notebooks"])
app.include_router(search.router, prefix="/api", tags=["search"])
app.include_router(models.router, prefix="/api", tags=["models"])
app.include_router(transformations.router, prefix="/api", tags=["transformations"])
app.include_router(notes.router, prefix="/api", tags=["notes"])
app.include_router(embedding.router, prefix="/api", tags=["embedding"])
app.include_router(
    embedding_rebuild.router, prefix="/api/embeddings", tags=["embeddings"]
)
app.include_router(settings.router, prefix="/api", tags=["settings"])
app.include_router(context.router, prefix="/api", tags=["context"])
app.include_router(sources.router, prefix="/api", tags=["sources"])
app.include_router(insights.router, prefix="/api", tags=["insights"])
app.include_router(summaries.router, prefix="/api", tags=["summaries"])
app.include_router(wiki_cards.router, prefix="/api", tags=["wiki-cards"])
app.include_router(commands_router.router, prefix="/api", tags=["commands"])
app.include_router(podcasts.router, prefix="/api", tags=["podcasts"])
app.include_router(episode_profiles.router, prefix="/api", tags=["episode-profiles"])
app.include_router(speaker_profiles.router, prefix="/api", tags=["speaker-profiles"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(source_chat.router, prefix="/api", tags=["source-chat"])
app.include_router(source_embeddings.router, prefix="/api", tags=["source-evidence"])
app.include_router(credentials.router, prefix="/api", tags=["credentials"])
app.include_router(languages.router, prefix="/api", tags=["languages"])
app.include_router(zotero.router, prefix="/api", tags=["zotero"])
app.mount("/api/images", StaticFiles(directory=IMAGES_FOLDER), name="images")


@app.get("/")
async def root():
    return {"message": "Open Research Notebook API is running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
