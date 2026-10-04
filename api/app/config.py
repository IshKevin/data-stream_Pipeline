from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    @field_validator("jwt_secret")
    @classmethod
    def _secret_long_enough(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
