"""Shared utilities for API routers."""


def ensure_prefix(value: str, prefix: str) -> str:
    """Ensure a record ID string has the given table prefix.

    Examples:
        ensure_prefix("abc123", "source") -> "source:abc123"
        ensure_prefix("source:abc123", "source") -> "source:abc123"
    """
    return value if value.startswith(f"{prefix}:") else f"{prefix}:{value}"


def ensure_source_id(source_id: str) -> str:
    """Ensure a source ID has the 'source:' prefix."""
    return ensure_prefix(source_id, "source")


def ensure_session_id(session_id: str) -> str:
    """Ensure a chat session ID has the 'chat_session:' prefix."""
    return ensure_prefix(session_id, "chat_session")
