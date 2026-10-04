.DEFAULT_GOAL := help
-include .env
export
COMPOSE ?= docker compose

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

.env: ## (internal) create .env from the example on first run
	cp .env.example .env
	@echo ">> Created .env from .env.example - edit the secrets before using this anywhere real."

up: .env ## Build and start everything (db, migrations, seed, api, web)
	$(COMPOSE) up --build -d
	@echo "Web: http://localhost:$(or $(WEB_PORT),8080)   API docs: http://localhost:$(or $(API_PORT),8000)/api/docs"

dev: .env ## Dev mode: rebuild + restart the API on code changes (docker compose watch)
	$(COMPOSE) up --build --watch

down: ## Stop the stack (keeps the database volume)
	$(COMPOSE) down

reset: ## Stop the stack and DELETE the database volume
	$(COMPOSE) down -v

logs: ## Follow logs
	$(COMPOSE) logs -f --tail=100

migrate: ## Re-run migrations + seed (idempotent)
	$(COMPOSE) run --rm migrate

import: ## Import a CSV:  make import FILE=seed/episodes.csv
	$(COMPOSE) run --rm -v "$(CURDIR)/$(FILE):/tmp/import.csv:ro" migrate python -m app.cli import-episodes /tmp/import.csv

test: .env ## Run the API test-suite in Docker (separate <db>_test database on the compose Postgres)
	$(COMPOSE) --profile test run --rm --build tests

ci: .env ## Run what GitHub CI runs (lint, types, tests, build, compose check) on this machine
	$(COMPOSE) config --quiet
	$(COMPOSE) up -d --wait db
	cd api && uv sync --frozen && uv run ruff check . && uv run ruff format --check . && uv run mypy app \
	  && POSTGRES_HOST=localhost POSTGRES_PORT=$(or $(DB_PORT),5434) uv run pytest
	cd web && npm ci && npm run lint && npm run typecheck && npm test && npm run build
	@echo "CI steps passed locally."

lint: ## Lint + type-check the API and type-check the web app
	cd api && uv run ruff check . && uv run ruff format --check . && uv run mypy app
	cd web && npm run lint && npm run typecheck

fmt: ## Auto-format the API
	cd api && uv run ruff check --fix . && uv run ruff format .

.PHONY: help ci up dev down reset logs migrate import test lint fmt
