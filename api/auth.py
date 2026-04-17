import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Optional

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from open_notebook.utils.encryption import get_secret_from_env


DEFAULT_AUTH_COOKIE_NAME = "open_notebook_auth"
DEFAULT_AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
AUTH_SESSION_VERSION = 1


def get_auth_cookie_name() -> str:
    configured = os.getenv("OPEN_NOTEBOOK_AUTH_COOKIE_NAME", DEFAULT_AUTH_COOKIE_NAME)
    return configured.strip() or DEFAULT_AUTH_COOKIE_NAME


def get_auth_session_secret() -> Optional[str]:
    return (
        get_secret_from_env("OPEN_NOTEBOOK_AUTH_SESSION_SECRET")
        or get_secret_from_env("OPEN_NOTEBOOK_ENCRYPTION_KEY")
        or get_secret_from_env("OPEN_NOTEBOOK_PASSWORD")
    )


def _urlsafe_b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _urlsafe_b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}")


def _auth_session_signing_key(password: str) -> bytes:
    session_secret = get_auth_session_secret() or password
    return hashlib.sha256(f"{session_secret}:{password}".encode()).digest()


def create_auth_session(password: str, max_age: int = DEFAULT_AUTH_COOKIE_MAX_AGE) -> str:
    issued_at = int(time.time())
    expires_at = issued_at + max(1, max_age)
    payload = {
        "v": AUTH_SESSION_VERSION,
        "iat": issued_at,
        "exp": expires_at,
    }
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    payload_token = _urlsafe_b64encode(payload_json)
    signature = hmac.new(
        _auth_session_signing_key(password),
        payload_token.encode(),
        hashlib.sha256,
    ).digest()
    return f"{payload_token}.{_urlsafe_b64encode(signature)}"


def decode_auth_session(token: str, password: str) -> Optional[dict[str, Any]]:
    try:
        payload_token, signature_token = token.split(".", 1)
    except ValueError:
        return None

    expected_signature = _urlsafe_b64encode(
        hmac.new(
            _auth_session_signing_key(password),
            payload_token.encode(),
            hashlib.sha256,
        ).digest()
    )
    if not hmac.compare_digest(signature_token, expected_signature):
        return None

    try:
        payload = json.loads(_urlsafe_b64decode(payload_token))
    except (ValueError, json.JSONDecodeError):
        return None

    if payload.get("v") != AUTH_SESSION_VERSION:
        return None

    expires_at = payload.get("exp")
    if not isinstance(expires_at, int) or expires_at < int(time.time()):
        return None

    return payload


def has_valid_auth_cookie(request: Request, password: str) -> bool:
    auth_cookie = request.cookies.get(get_auth_cookie_name())
    if not auth_cookie:
        return False
    return decode_auth_session(auth_cookie, password) is not None


def _parse_bearer_authorization(auth_header: str) -> str:
    scheme, credentials = auth_header.split(" ", 1)
    if scheme.lower() != "bearer":
        raise ValueError("Invalid authentication scheme")
    return credentials


def get_request_password(request: Request) -> tuple[Optional[str], Optional[str]]:
    auth_header = request.headers.get("Authorization")

    if auth_header:
        try:
            return _parse_bearer_authorization(auth_header), None
        except ValueError:
            return None, "Invalid authorization header format"

    return None, None


class PasswordAuthMiddleware(BaseHTTPMiddleware):
    """
    Middleware to check password authentication for all API requests.
    Accepts either an Authorization bearer token or an auth cookie.
    Supports Docker secrets via OPEN_NOTEBOOK_PASSWORD_FILE.
    """

    def __init__(self, app, excluded_paths: Optional[list] = None):
        super().__init__(app)
        self.password = get_secret_from_env("OPEN_NOTEBOOK_PASSWORD")
        self.excluded_paths = excluded_paths or [
            "/",
            "/health",
            "/docs",
            "/openapi.json",
            "/redoc",
        ]

    def _is_excluded_path(self, path: str) -> bool:
        for excluded_path in self.excluded_paths:
            if path == excluded_path or path.startswith(f"{excluded_path}/"):
                return True
        return False

    async def dispatch(self, request: Request, call_next):
        # Skip authentication if no password is set
        if not self.password:
            return await call_next(request)

        # Skip authentication for excluded paths
        if self._is_excluded_path(request.url.path):
            return await call_next(request)

        # Skip authentication for CORS preflight requests (OPTIONS)
        if request.method == "OPTIONS":
            return await call_next(request)

        credentials, parse_error = get_request_password(request)
        cookie_authenticated = has_valid_auth_cookie(request, self.password)

        if parse_error and not cookie_authenticated:
            return JSONResponse(
                status_code=401,
                content={"detail": parse_error},
                headers={"WWW-Authenticate": "Bearer"},
            )

        bearer_authenticated = credentials == self.password if credentials else False

        if not credentials and not cookie_authenticated:
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing authorization header or auth cookie"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        if not bearer_authenticated and not cookie_authenticated:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid password"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Password is correct, proceed with the request
        response = await call_next(request)
        return response


# Optional: HTTPBearer security scheme for OpenAPI documentation
security = HTTPBearer(auto_error=False)


def check_api_password(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> bool:
    """
    Utility function to check API password.
    Can be used as a dependency in individual routes if needed.
    Supports Docker secrets via OPEN_NOTEBOOK_PASSWORD_FILE.
    Returns True without checking credentials if OPEN_NOTEBOOK_PASSWORD is not configured.
    Raises 401 if the authorization header or auth cookie is missing or invalid.
    """
    password = get_secret_from_env("OPEN_NOTEBOOK_PASSWORD")

    # No password configured - skip authentication
    if not password:
        return True

    request_password = credentials.credentials if credentials else None
    cookie_authenticated = has_valid_auth_cookie(request, password)

    if not request_password and not cookie_authenticated:
        raise HTTPException(
            status_code=401,
            detail="Missing authorization",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if request_password == password or cookie_authenticated:
        return True

    raise HTTPException(
        status_code=401,
        detail="Invalid password",
        headers={"WWW-Authenticate": "Bearer"},
    )
