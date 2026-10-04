import re


def normalize_task_name(value: str) -> str:
    """Canonical form for task names: trimmed, single-spaced, lower-case."""
    return re.sub(r"\s+", " ", value).strip().lower()
