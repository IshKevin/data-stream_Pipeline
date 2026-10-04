import os
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


def build_database_url() -> str:
    """`DATABASE_URL` if set, otherwise assembled from the POSTGRES_* variables.

    Building the URL here (instead of string-interpolating it in docker-compose.yml) means a
    password containing characters such as `@ / # : %` is escaped correctly."""
    explicit = os.environ.get("DATABASE_URL")
    if explicit:
        return explicit

    def env(name: str, default: str) -> str:
        return os.environ.get(name) or default  # an empty value counts as "not set"

    return URL.create(
        "postgresql+psycopg",
        username=env("POSTGRES_USER", "data-stream_pipeline"),
        password=env("POSTGRES_PASSWORD", "data-stream_pipeline"),
        host=env("POSTGRES_HOST", "localhost"),
        port=int(env("POSTGRES_PORT", "5432")),
        database=env("POSTGRES_DB", "data-stream_pipeline"),
    ).render_as_string(hide_password=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    database_url: str = Field(default_factory=build_database_url)
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60
    log_level: str = "INFO"

    known_robots: list[str] = ["arm-01", "arm-02", "arm-03", "mobile-01", "humanoid-01"]
    max_episode_duration_seconds: int = 3600
    max_upload_mb: int = 50

    @field_validator("jwt_secret")
    @classmethod
    def _secret_long_enough(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
