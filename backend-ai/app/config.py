"""CrimeNetX AI service — application configuration.

All secrets come from environment variables. Missing keys degrade gracefully:
LLM-dependent features return deterministic rule-based fallbacks so the
platform remains demonstrable without paid API keys.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Service wiring ---
    app_name: str = "CrimeNetX AI Service"
    version: str = "1.0.0"
    node_backend_url: str = "http://localhost:5000"
    allowed_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # --- LLM: Groq is PRIMARY for all text/reasoning ---
    groq_api_key: str = ""
    groq_model: str = "groq/compound-mini"

    # --- Gemini used ONLY for multimodal vision (CCTV/photo matching) ---
    gemini_api_key: str = ""
    gemini_vision_model: str = "gemini-1.5-flash"

    # --- Storage ---
    chroma_persist_dir: str = "./chroma_data"
    redis_url: str = "redis://localhost:6379"
    database_url: str = ""
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "crimenetx_neo4j_pass"

    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "ap-south-1"
    aws_s3_bucket: str = "crimenetx-evidence"

    @property
    def groq_enabled(self) -> bool:
        return bool(self.groq_api_key)

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
