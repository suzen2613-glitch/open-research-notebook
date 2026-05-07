"""
Authentication router for Open Notebook API.
Provides endpoints to check authentication status.
"""

import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.auth import create_auth_session, get_auth_cookie_name
from open_notebook.utils.encryption import get_secret_from_env

router = APIRouter(prefix="/auth", tags=["auth"])


class PasswordLoginRequest(BaseModel):
    password: str


def _cookie_secure(request: Request) -> bool:
    configured = os.getenv("OPEN_NOTEBOOK_AUTH_COOKIE_SECURE", "auto").strip().lower()
    if configured in {"1", "true", "yes", "on"}:
        return True
    if configured in {"0", "false", "no", "off"}:
        return False
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return proto == "https"


def _cookie_samesite() -> str:
    configured = os.getenv("OPEN_NOTEBOOK_AUTH_COOKIE_SAMESITE", "lax").strip().lower()
    if configured not in {"lax", "strict", "none"}:
        return "lax"
    return configured


def _cookie_domain() -> str | None:
    configured = os.getenv("OPEN_NOTEBOOK_AUTH_COOKIE_DOMAIN", "").strip()
    return configured or None


def _cookie_max_age() -> int:
    configured = os.getenv("OPEN_NOTEBOOK_AUTH_COOKIE_MAX_AGE", "").strip()
    if configured.isdigit():
        return int(configured)
    return 60 * 60 * 24 * 30


@router.get("/status")
async def get_auth_status():
    """
    Check if authentication is enabled.
    Returns whether a password is required to access the API.
    Supports Docker secrets via OPEN_NOTEBOOK_PASSWORD_FILE.
    """
    password_configured = bool(get_secret_from_env("OPEN_NOTEBOOK_PASSWORD"))

    return {
        "auth_enabled": True,
        "auth_configured": password_configured,
        "auth_cookie_name": get_auth_cookie_name() if password_configured else None,
        "message": "Authentication is required"
        if password_configured
        else "OPEN_NOTEBOOK_PASSWORD is not configured",
    }


@router.post("/login")
async def login(payload: PasswordLoginRequest, request: Request):
    password = get_secret_from_env("OPEN_NOTEBOOK_PASSWORD")
    if not password:
        raise HTTPException(
            status_code=403,
            detail="OPEN_NOTEBOOK_PASSWORD is not configured.",
        )

    if payload.password != password:
        raise HTTPException(status_code=401, detail="Invalid password")

    response = JSONResponse(
        {"authenticated": True, "auth_enabled": True},
        status_code=200,
    )
    cookie_max_age = _cookie_max_age()
    response.set_cookie(
        key=get_auth_cookie_name(),
        value=create_auth_session(password, max_age=cookie_max_age),
        httponly=True,
        secure=_cookie_secure(request),
        samesite=_cookie_samesite(),
        max_age=cookie_max_age,
        path="/",
        domain=_cookie_domain(),
    )
    return response


@router.post("/logout")
async def logout():
    response = JSONResponse({"authenticated": False}, status_code=200)
    response.delete_cookie(
        key=get_auth_cookie_name(),
        path="/",
        domain=_cookie_domain(),
    )
    return response
