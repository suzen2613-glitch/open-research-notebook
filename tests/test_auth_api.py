import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from api.auth import PasswordAuthMiddleware, get_auth_cookie_name
from api.routers import auth as auth_router


@pytest.fixture
def auth_client(monkeypatch):
    monkeypatch.setenv("OPEN_NOTEBOOK_PASSWORD", "test-secret")
    monkeypatch.setenv("OPEN_NOTEBOOK_AUTH_SESSION_SECRET", "session-secret")
    monkeypatch.delenv("OPEN_NOTEBOOK_AUTH_COOKIE_NAME", raising=False)

    app = FastAPI()
    app.add_middleware(
        PasswordAuthMiddleware,
        excluded_paths=[
            "/api/auth/status",
            "/api/auth/login",
            "/api/auth/logout",
        ],
    )
    app.include_router(auth_router.router, prefix="/api")

    @app.get("/api/private")
    async def private():
        return JSONResponse({"ok": True})

    return TestClient(app)


def test_login_sets_auth_cookie(auth_client):
    response = auth_client.post("/api/auth/login", json={"password": "test-secret"})

    assert response.status_code == 200
    cookie_value = response.cookies.get(get_auth_cookie_name())
    assert cookie_value
    assert cookie_value != "test-secret"
    assert "." in cookie_value


def test_protected_endpoint_accepts_auth_cookie(auth_client):
    login_response = auth_client.post(
        "/api/auth/login", json={"password": "test-secret"}
    )
    cookie_name = get_auth_cookie_name()

    response = auth_client.get(
        "/api/private",
        cookies={cookie_name: login_response.cookies.get(cookie_name)},
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_protected_endpoint_rejects_tampered_auth_cookie(auth_client):
    login_response = auth_client.post(
        "/api/auth/login", json={"password": "test-secret"}
    )
    cookie_name = get_auth_cookie_name()
    cookie_value = login_response.cookies.get(cookie_name)
    assert cookie_value is not None

    tampered_cookie = f"{cookie_value[:-1]}{'a' if cookie_value[-1] != 'a' else 'b'}"
    response = auth_client.get(
        "/api/private",
        cookies={cookie_name: tampered_cookie},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid password"


def test_protected_endpoint_rejects_missing_auth(auth_client):
    response = auth_client.get("/api/private")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing authorization header or auth cookie"
