from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Hosting platforms (Render, Heroku, ...) hand out `postgres://` / `postgresql://` URLs;
    SQLAlchemy needs to be told to use the psycopg 3 driver."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str = "postgresql+psycopg://desk:desk@localhost:5432/desk"
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    log_level: str = "INFO"

    known_robots: list[str] = ["arm-01", "arm-02", "arm-03", "mobile-01", "humanoid-01"]
    max_episode_duration_seconds: int = 3600
    max_upload_mb: int = 50

    # When set (single-container deployments, e.g. Render) the API also serves the built web app.
    web_dist_dir: Path | None = None

    @field_validator("database_url")
    @classmethod
    def _driver_prefix(cls, v: str) -> str:
        return normalize_database_url(v)

    @field_validator("jwt_secret")
    @classmethod
    def _secret_long_enough(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
