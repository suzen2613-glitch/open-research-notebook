import os


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# ROOT DATA FOLDER
DATA_FOLDER = "./data"

# LANGGRAPH CHECKPOINT FILE
sqlite_folder = f"{DATA_FOLDER}/sqlite-db"
os.makedirs(sqlite_folder, exist_ok=True)
LANGGRAPH_CHECKPOINT_FILE = f"{sqlite_folder}/checkpoints.sqlite"

# UPLOADS FOLDER
UPLOADS_FOLDER = f"{DATA_FOLDER}/uploads"
os.makedirs(UPLOADS_FOLDER, exist_ok=True)

# IMAGE STORAGE / STATIC SERVER
IMAGES_FOLDER = os.getenv("OPEN_NOTEBOOK_IMAGE_DIR", "./images")
os.makedirs(IMAGES_FOLDER, exist_ok=True)
IMAGE_SERVER_URL = os.getenv("OPEN_NOTEBOOK_IMAGE_SERVER_URL", "/api/images")

# PDF CONVERSION
PDF_CONVERSION_ENGINE = os.getenv("PDF_CONVERSION_ENGINE", "auto").lower()
PDF_CONVERSION_AUTO_ORDER = os.getenv(
    "PDF_CONVERSION_AUTO_ORDER", "mineru_cloud,mineru,marker"
)
MINERU_COMMAND = os.getenv("MINERU_COMMAND", "mineru")
MINERU_EXTRA_ARGS = os.getenv("MINERU_EXTRA_ARGS", "")
MINERU_TIMEOUT_SECONDS = _env_int("MINERU_TIMEOUT_SECONDS", 600)
MINERU_CLOUD_API_BASE_URL = os.getenv(
    "MINERU_CLOUD_API_BASE_URL", "https://mineru.net"
).rstrip("/")
MINERU_CLOUD_API_TOKEN = os.getenv("MINERU_CLOUD_API_TOKEN", "").strip()
MINERU_CLOUD_MODEL_VERSION = os.getenv("MINERU_CLOUD_MODEL_VERSION", "vlm").strip()
MINERU_CLOUD_LANGUAGE = os.getenv("MINERU_CLOUD_LANGUAGE", "en").strip()
MINERU_CLOUD_TIMEOUT_SECONDS = _env_int("MINERU_CLOUD_TIMEOUT_SECONDS", 600)
MINERU_CLOUD_POLL_INTERVAL_SECONDS = _env_int(
    "MINERU_CLOUD_POLL_INTERVAL_SECONDS", 2
)
MINERU_CLOUD_ENABLE_FORMULA = _env_bool("MINERU_CLOUD_ENABLE_FORMULA", True)
MINERU_CLOUD_ENABLE_TABLE = _env_bool("MINERU_CLOUD_ENABLE_TABLE", True)
MINERU_CLOUD_ENABLE_OCR = _env_bool("MINERU_CLOUD_ENABLE_OCR", False)

# TIKTOKEN CACHE FOLDER
TIKTOKEN_CACHE_DIR = f"{DATA_FOLDER}/tiktoken-cache"
os.makedirs(TIKTOKEN_CACHE_DIR, exist_ok=True)
