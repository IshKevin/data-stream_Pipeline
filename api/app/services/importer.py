"""Episode CSV import.

Design goals
  * Idempotent: ``episode_id`` is UNIQUE and rows are written with
    ``INSERT .. ON CONFLICT DO NOTHING``, so re-running the same file creates nothing new.
    (Existing episodes are never overwritten - an episode that has been assigned must not
    change quality underneath a client.)
  * Honest: every row that is not imported is reported with a machine-readable reason.
  * Cheap: rows are validated in Python (needed for the report) but written in batches.
  * Atomic: one transaction; an unexpected failure leaves the database untouched.
"""

import contextlib
import csv
import io
import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import BinaryIO

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import QUALITIES, Episode
from app.services.normalize import normalize_task_name

log = logging.getLogger("app.importer")

COLUMNS = (
    "episode_id",
    "robot_id",
    "task_name",
    "recorded_at",
    "duration_seconds",
    "operator_name",
    "quality",
)
BATCH_SIZE = 2000
_EPISODES = Episode.__table__
_INSERT = (
    pg_insert(_EPISODES)  # type: ignore[arg-type]
    .on_conflict_do_nothing(index_elements=["episode_id"])
    .returning(_EPISODES.c.episode_id)
)
MAX_REPORTED_ROWS = 1000
_CANONICAL_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$")
_EPISODE_ID = re.compile(r"^EP-\d+$")
_DAY_FIRST_FORMATS = ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y")

REASONS = {
    "blank_row": "The line was empty.",
    "malformed_row": "The row does not have the expected number of columns.",
    "missing_episode_id": "episode_id is blank.",
    "invalid_episode_id": "episode_id is not of the form EP-<digits>.",
    "missing_robot_id": "robot_id is blank.",
    "unknown_robot": "robot_id is not one of the known robots.",
    "missing_task_name": "task_name is blank.",
    "missing_recorded_at": "recorded_at is blank.",
    "invalid_recorded_at": "recorded_at could not be parsed as a date/time.",
    "date_out_of_range": "recorded_at is in the future or implausibly old.",
    "missing_duration": "duration_seconds is blank.",
    "invalid_duration": "duration_seconds is not a positive number.",
    "duration_out_of_range": "duration_seconds is larger than the allowed maximum.",
    "missing_quality": "quality is blank, so the episode could not be safely assigned.",
    "invalid_quality": "quality is not one of good / usable / bad.",
    "field_too_long": "A text field is longer than allowed.",
    "duplicate_in_file": "Same episode_id appeared earlier in the file with identical data.",
    "conflicting_duplicate_in_file": (
        "Same episode_id appeared earlier in the file with different data; the first row wins."
    ),
    "already_exists": "An episode with this episode_id is already in the database (left untouched).",
}


class FatalImportError(Exception):
    """The file as a whole cannot be imported (bad encoding, missing columns, ...)."""


class RowRejected(Exception):
    def __init__(self, reason: str, detail: str = ""):
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


@dataclass
class ParsedRow:
    values: dict
    normalizations: list[str] = field(default_factory=list)


def parse_timestamp(raw: str, norm: list[str]) -> datetime:
    text = raw.strip()
    parsed: datetime | None = None
    try:
        parsed = datetime.fromisoformat(text)
        if not _CANONICAL_TS.match(text):
            norm.append("date_format_converted")
    except ValueError:
        for fmt in _DAY_FIRST_FORMATS:  # slash dates are read day-first (dd/mm/yyyy)
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        if parsed is None:
            raise RowRejected("invalid_recorded_at", f"unrecognised date '{text}'") from None
        norm.append("date_format_converted")
    # naive timestamps are assumed to be UTC
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def parse_row(raw: dict[str, str]) -> ParsedRow:
    s = get_settings()
    norm: list[str] = []

    episode_id = raw["episode_id"].strip()
    if not episode_id:
        raise RowRejected("missing_episode_id")
    if episode_id != episode_id.upper():
        norm.append("episode_id_normalized")
    episode_id = episode_id.upper()
    if not _EPISODE_ID.match(episode_id):
        raise RowRejected("invalid_episode_id", f"'{episode_id}'")
    if len(episode_id) > 64:
        raise RowRejected("field_too_long", "episode_id")

    robot_raw = raw["robot_id"]
    robot_id = robot_raw.strip().lower()
    if not robot_id:
        raise RowRejected("missing_robot_id")
    if robot_id not in s.known_robots:
        raise RowRejected("unknown_robot", f"'{robot_id}'")
    if robot_id != robot_raw:
        norm.append("robot_id_normalized")

    task_raw = raw["task_name"]
    task_name = normalize_task_name(task_raw)
    if not task_name:
        raise RowRejected("missing_task_name")
    if len(task_name) > 200:
        raise RowRejected("field_too_long", "task_name")
    if task_name != task_raw:
        norm.append("task_name_normalized")

    if not raw["recorded_at"].strip():
        raise RowRejected("missing_recorded_at")
    recorded_at = parse_timestamp(raw["recorded_at"], norm)
    now = datetime.now(UTC)
    if recorded_at > now + timedelta(days=1) or recorded_at.year < 2000:
        raise RowRejected("date_out_of_range", recorded_at.isoformat())

    dur_raw = raw["duration_seconds"].strip()
    if not dur_raw:
        raise RowRejected("missing_duration")
    try:
        dur_float = float(dur_raw)
    except ValueError:
        raise RowRejected("invalid_duration", f"'{dur_raw}'") from None
    if dur_float != dur_float or dur_float in (float("inf"), float("-inf")) or dur_float <= 0:
        raise RowRejected("invalid_duration", f"'{dur_raw}'")
    duration = int(dur_float + 0.5)  # round half up (not banker's rounding)
    if duration != dur_float:
        norm.append("duration_rounded")
    if duration < 1:
        raise RowRejected("invalid_duration", f"'{dur_raw}'")
    if duration > s.max_episode_duration_seconds:
        raise RowRejected(
            "duration_out_of_range", f"{duration}s > {s.max_episode_duration_seconds}s"
        )

    operator = raw["operator_name"].strip() or None
    if operator is None:
        norm.append("operator_missing")  # imported anyway: operator is informational only
    elif len(operator) > 200:
        raise RowRejected("field_too_long", "operator_name")

    quality_raw = raw["quality"]
    quality = quality_raw.strip().lower()
    if not quality:
        raise RowRejected("missing_quality")
    if quality not in QUALITIES:
        raise RowRejected("invalid_quality", f"'{quality_raw.strip()}'")
    if quality != quality_raw:
        norm.append("quality_normalized")

    return ParsedRow(
        values={
            "episode_id": episode_id,
            "robot_id": robot_id,
            "task_name": task_name,
            "recorded_at": recorded_at,
            "duration_seconds": duration,
            "operator_name": operator,
            "quality": quality,
        },
        normalizations=norm,
    )


def import_episodes(db: Session, binary_file: BinaryIO, *, filename: str = "episodes.csv") -> dict:
    try:
        text = io.TextIOWrapper(binary_file, encoding="utf-8-sig", newline="")
        reader = csv.reader(text)
        header = next(reader, None)
        while header is not None and not any(c.strip() for c in header):
            header = next(reader, None)  # tolerate leading blank lines
        if header is None:
            raise FatalImportError("The file is empty")
        header = [h.strip().lower() for h in header]
        missing = [c for c in COLUMNS if c not in header]
        if missing:
            raise FatalImportError(f"Missing required column(s): {', '.join(missing)}")
        index = {name: header.index(name) for name in COLUMNS}

        reasons: Counter[str] = Counter()
        normalizations: Counter[str] = Counter()
        skipped_rows: list[dict] = []
        seen: dict[str, tuple] = {}
        batch: list[dict] = []
        batch_lines: dict[str, int] = {}
        rows_total = 0
        imported = 0

        def skip(line: int, episode_id: str | None, reason: str, detail: str = "") -> None:
            reasons[reason] += 1
            if len(skipped_rows) < MAX_REPORTED_ROWS:
                skipped_rows.append(
                    {"line": line, "episode_id": episode_id, "reason": reason, "detail": detail}
                )

        def flush() -> None:
            nonlocal imported
            if not batch:
                return
            # One cached statement executed with a list of parameter sets ("insertmanyvalues"):
            # SQLAlchemy batches it into multi-row INSERTs without recompiling per batch.
            # Rows that hit ON CONFLICT DO NOTHING are simply absent from RETURNING.
            inserted: set[str] = set(db.execute(_INSERT, batch).scalars())
            imported += len(inserted)
            for row in batch:
                if row["episode_id"] not in inserted:
                    skip(batch_lines[row["episode_id"]], row["episode_id"], "already_exists")
            batch.clear()
            batch_lines.clear()

        for row in reader:
            rows_total += 1
            line = reader.line_num
            if not any(cell.strip() for cell in row):
                skip(line, None, "blank_row")
                continue
            if len(row) != len(header):
                guess = row[index["episode_id"]].strip() if len(row) > index["episode_id"] else None
                skip(
                    line,
                    guess or None,
                    "malformed_row",
                    f"expected {len(header)} fields, got {len(row)}",
                )
                continue
            raw = {name: row[i] for name, i in index.items()}
            try:
                parsed = parse_row(raw)
            except RowRejected as exc:
                skip(line, raw["episode_id"].strip() or None, exc.reason, exc.detail)
                continue

            values = parsed.values
            signature = tuple(values[c] for c in COLUMNS[1:])
            eid = values["episode_id"]
            if eid in seen:
                same = seen[eid] == signature
                skip(
                    line,
                    eid,
                    "duplicate_in_file" if same else "conflicting_duplicate_in_file",
                    "" if same else "differs from the first occurrence, which was kept",
                )
                continue
            seen[eid] = signature
            normalizations.update(parsed.normalizations)
            batch.append(values)
            batch_lines[eid] = line
            if len(batch) >= BATCH_SIZE:
                flush()
        flush()
        db.commit()
    except UnicodeDecodeError:
        db.rollback()
        raise FatalImportError("The file is not valid UTF-8") from None
    except csv.Error as exc:
        db.rollback()
        raise FatalImportError(f"The file is not valid CSV: {exc}") from None
    except Exception:
        db.rollback()
        raise
    finally:
        with contextlib.suppress(Exception):
            text.detach()  # don't close the caller's file object

    skipped = sum(reasons.values())
    report = {
        "filename": filename,
        "rows_total": rows_total,
        "imported": imported,
        "skipped": skipped,
        "skipped_by_reason": dict(reasons),
        "reason_descriptions": {r: REASONS[r] for r in reasons},
        "normalizations": dict(normalizations),
        "skipped_rows": skipped_rows,
        "skipped_rows_truncated": skipped > len(skipped_rows),
    }
    log.info(
        "episode import finished",
        extra={
            "source_file": filename,
            "rows_total": rows_total,
            "imported": imported,
            "skipped": skipped,
            "skipped_by_reason": dict(reasons),
        },
    )
    return report
