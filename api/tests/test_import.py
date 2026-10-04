"""CSV import: normalisation, rejection reasons, and - above all - idempotency."""

import io
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from app.models import Episode
from app.services.importer import (
    BATCH_SIZE,
    FatalImportError,
    RowRejected,
    import_episodes,
    parse_row,
)
from tests.conftest import SEED_DIR, auth

HEADER = "episode_id,robot_id,task_name,recorded_at,duration_seconds,operator_name,quality\n"


def run_import(db, text: str | bytes, name="t.csv"):
    data = text.encode() if isinstance(text, str) else text
    return import_episodes(db, io.BytesIO(data), filename=name)


def count(db) -> int:
    return db.scalar(select(func.count()).select_from(Episode))


# ---- idempotency -------------------------------------------------------------------------
def test_importing_the_same_file_twice_creates_no_duplicates(db):
    raw = (SEED_DIR / "episodes.csv").read_bytes()
    first = run_import(db, raw)
    n_after_first = count(db)
    assert first["imported"] == n_after_first > 100

    second = run_import(db, raw)
    assert second["imported"] == 0
    assert count(db) == n_after_first
    # everything that was valid the first time is now reported as already present
    assert second["skipped_by_reason"]["already_exists"] == first["imported"]


def test_reimport_never_overwrites_existing_episodes(db):
    run_import(db, HEADER + "EP-1,arm-01,pick cup,2026-09-01T10:00:00,30,Aline,good\n")
    again = run_import(db, HEADER + "EP-1,arm-02,fold towel,2026-09-02T10:00:00,99,Eric,bad\n")
    assert again["imported"] == 0
    ep = db.execute(select(Episode)).scalar_one()
    assert (ep.robot_id, ep.task_name, ep.quality, ep.duration_seconds) == (
        "arm-01",
        "pick cup",
        "good",
        30,
    )


def test_import_is_idempotent_across_batch_boundaries(db):
    n = BATCH_SIZE * 2 + 17
    rows = "".join(
        f"EP-{i},arm-01,pick cup,2026-09-01T10:00:00,30,Aline,good\n" for i in range(1, n + 1)
    )
    assert run_import(db, HEADER + rows)["imported"] == n
    assert run_import(db, HEADER + rows)["imported"] == 0
    assert count(db) == n
    # a partially overlapping file only adds the new rows
    more = "".join(
        f"EP-{i},arm-01,pick cup,2026-09-01T10:00:00,30,Aline,good\n" for i in range(n - 4, n + 6)
    )
    report = run_import(db, HEADER + more)
    assert report["imported"] == 5
    assert report["skipped_by_reason"] == {"already_exists": 5}
    assert count(db) == n + 5


def test_seed_file_report(db):
    report = run_import(db, (SEED_DIR / "episodes.csv").read_bytes(), "episodes.csv")
    by = report["skipped_by_reason"]
    assert report["imported"] + report["skipped"] == report["rows_total"]
    # one entry per kind of mess documented in seed/README.md
    assert by["duplicate_in_file"] == 2  # EP-00030, EP-00074 repeated verbatim
    assert by["conflicting_duplicate_in_file"] == 2  # EP-00011 (bad vs good), ep-00003 vs EP-00003
    assert by["unknown_robot"] == 1
    assert by["missing_robot_id"] == 1
    assert by["missing_episode_id"] == 1
    assert by["invalid_quality"] == 1
    assert by["missing_quality"] == 1
    assert by["invalid_recorded_at"] == 1  # 'not a date'
    assert by["date_out_of_range"] == 1  # 2031-01-01: recorded in the future
    assert by["missing_duration"] == 1
    assert by["invalid_duration"] == 2  # -5 and 'N/A' (45.5 is rounded, not rejected)
    assert by["duration_out_of_range"] == 1
    assert by["malformed_row"] == 1
    assert by["blank_row"] == 2
    # every skipped row is explained
    assert all(r["reason"] in report["reason_descriptions"] for r in report["skipped_rows"])


def test_seed_file_values_after_import(db):
    run_import(db, (SEED_DIR / "episodes.csv").read_bytes())

    def get(eid):
        return db.execute(select(Episode).where(Episode.episode_id == eid)).scalar_one_or_none()

    assert get("EP-00011").quality == "bad"  # first occurrence wins over the later 'good'
    assert get("EP-00003").robot_id == "humanoid-01"  # not clobbered by 'ep-00003'
    assert get("EP-00006").task_name == "pick cup"  # '  Pick Cup ' normalised
    assert get("EP-00007").task_name == "pick cup"
    assert get("EP-00008").robot_id == "arm-01"  # leading space trimmed
    assert get("EP-00009").quality == "good"  # 'Good' lower-cased
    assert get("EP-00010").quality == "usable"
    assert get("EP-00013").recorded_at == datetime(
        2026, 8, 14, 9, 12, tzinfo=UTC
    )  # space separator
    assert get("EP-00014").recorded_at == datetime(2026, 8, 14, 9, 15, tzinfo=UTC)  # dd/mm/yyyy
    assert get("EP-00015").recorded_at == datetime(2026, 8, 14, 9, 20, tzinfo=UTC)  # trailing Z
    assert get("EP-00018").duration_seconds == 46  # 45.5 rounded half-up
    assert get("EP-90005").operator_name is None  # missing operator is allowed
    for rejected in (
        "EP-00019",
        "EP-00020",
        "EP-00016",
        "EP-00017",
        "EP-00021",
        "EP-00023",
        "EP-00024",
        "EP-90001",
        "EP-90003",
        "EP-90004",
    ):
        assert get(rejected) is None, rejected


# ---- row parsing (unit) ----------------------------------------------------------------------
def row(**over):
    base = {
        "episode_id": "EP-1",
        "robot_id": "arm-01",
        "task_name": "pick cup",
        "recorded_at": "2026-09-01T10:00:00",
        "duration_seconds": "30",
        "operator_name": "Aline",
        "quality": "good",
    }
    return {**base, **over}


@pytest.mark.parametrize(
    ("over", "reason"),
    [
        ({"episode_id": ""}, "missing_episode_id"),
        ({"episode_id": "XX-1"}, "invalid_episode_id"),
        ({"robot_id": ""}, "missing_robot_id"),
        ({"robot_id": "arm-99"}, "unknown_robot"),
        ({"task_name": "  "}, "missing_task_name"),
        ({"recorded_at": ""}, "missing_recorded_at"),
        ({"recorded_at": "yesterday"}, "invalid_recorded_at"),
        ({"recorded_at": "2999-01-01T00:00:00"}, "date_out_of_range"),
        ({"recorded_at": "1970-01-01T00:00:00"}, "date_out_of_range"),
        ({"duration_seconds": ""}, "missing_duration"),
        ({"duration_seconds": "abc"}, "invalid_duration"),
        ({"duration_seconds": "0"}, "invalid_duration"),
        ({"duration_seconds": "-1"}, "invalid_duration"),
        ({"duration_seconds": "nan"}, "invalid_duration"),
        ({"duration_seconds": "inf"}, "invalid_duration"),
        ({"duration_seconds": "0.2"}, "invalid_duration"),
        ({"duration_seconds": "99999999"}, "duration_out_of_range"),
        ({"quality": ""}, "missing_quality"),
        ({"quality": "excellent"}, "invalid_quality"),
        ({"task_name": "x" * 201}, "field_too_long"),
    ],
)
def test_row_rejections(over, reason):
    with pytest.raises(RowRejected) as exc:
        parse_row(row(**over))
    assert exc.value.reason == reason


def test_row_normalisations():
    p = parse_row(
        row(
            episode_id="ep-7",
            robot_id=" ARM-01 ",
            task_name=" Pick   CUP ",
            quality=" Usable ",
            operator_name="",
        )
    )
    assert p.values["episode_id"] == "EP-7"
    assert p.values["robot_id"] == "arm-01"
    assert p.values["task_name"] == "pick cup"
    assert p.values["quality"] == "usable"
    assert p.values["operator_name"] is None
    assert {
        "episode_id_normalized",
        "robot_id_normalized",
        "task_name_normalized",
        "quality_normalized",
        "operator_missing",
    } <= set(p.normalizations)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026-09-01T10:00:00", datetime(2026, 9, 1, 10, 0, tzinfo=UTC)),
        ("2026-09-01 10:00:00", datetime(2026, 9, 1, 10, 0, tzinfo=UTC)),
        ("2026-09-01T10:00:00Z", datetime(2026, 9, 1, 10, 0, tzinfo=UTC)),
        ("2026-09-01T12:00:00+02:00", datetime(2026, 9, 1, 10, 0, tzinfo=UTC)),
        ("01/09/2026 10:00", datetime(2026, 9, 1, 10, 0, tzinfo=UTC)),  # day first
        ("14/08/2026 09:15:30", datetime(2026, 8, 14, 9, 15, 30, tzinfo=UTC)),
    ],
)
def test_timestamp_formats_become_utc(raw, expected):
    assert parse_row(row(recorded_at=raw)).values["recorded_at"] == expected


# ---- whole-file behaviour -------------------------------------------------------------------
def test_duplicates_and_blank_lines_within_file(db):
    text = HEADER + (
        "EP-1,arm-01,pick cup,2026-09-01T10:00:00,30,Aline,good\n"
        "\n"
        "EP-1,arm-01,pick cup,2026-09-01T10:00:00,30,Aline,good\n"
        "EP-1,arm-01,pick cup,2026-09-01T10:00:00,31,Aline,good\n"
    )
    report = run_import(db, text)
    assert report["imported"] == 1
    assert report["skipped_by_reason"] == {
        "blank_row": 1,
        "duplicate_in_file": 1,
        "conflicting_duplicate_in_file": 1,
    }
    assert [r["line"] for r in report["skipped_rows"]] == [3, 4, 5]


def test_an_invalid_first_row_does_not_block_a_valid_later_row_with_same_id(db):
    text = HEADER + (
        "EP-1,arm-99,pick cup,2026-09-01T10:00:00,30,Aline,good\n"
        "EP-1,arm-01,pick cup,2026-09-01T10:00:00,30,Aline,good\n"
    )
    report = run_import(db, text)
    assert report["imported"] == 1 and report["skipped_by_reason"] == {"unknown_robot": 1}


def test_columns_may_be_reordered_and_header_is_case_insensitive(db):
    text = "Quality,Episode_ID,robot_id,task_name,recorded_at,duration_seconds,operator_name\ngood,EP-5,arm-01,pick cup,2026-09-01T10:00:00,30,Aline\n"
    assert run_import(db, text)["imported"] == 1


def test_bom_and_crlf_are_handled(db):
    text = ("﻿" + HEADER + "EP-1,arm-01,pick cup,2026-09-01T10:00:00,30,Aline,good\n").replace(
        "\n", "\r\n"
    )
    assert run_import(db, text)["imported"] == 1


@pytest.mark.parametrize(
    "content",
    [b"", b"\n\n", b"episode_id,robot_id\nEP-1,arm-01\n", b"\xff\xfe\x00bad bytes"],
)
def test_unusable_files_fail_cleanly_and_import_nothing(db, content):
    with pytest.raises(FatalImportError):
        run_import(db, content)
    assert count(db) == 0


def test_failed_import_is_atomic(db, monkeypatch):
    import app.services.importer as imp

    monkeypatch.setattr(imp, "BATCH_SIZE", 2)
    original = imp.parse_row
    calls = {"n": 0}

    def exploding(raw):
        calls["n"] += 1
        if calls["n"] == 5:
            raise RuntimeError("boom")
        return original(raw)

    monkeypatch.setattr(imp, "parse_row", exploding)
    rows = "".join(
        f"EP-{i},arm-01,pick cup,2026-09-01T10:00:00,30,Aline,good\n" for i in range(1, 8)
    )
    with pytest.raises(RuntimeError):
        run_import(db, HEADER + rows)
    assert count(db) == 0  # earlier batches were rolled back too


# ---- HTTP endpoint ---------------------------------------------------------------------------
def test_upload_endpoint_end_to_end(client, make):
    op = make.user("operator")
    raw = (SEED_DIR / "episodes.csv").read_bytes()

    def up():
        files = {"file": ("episodes.csv", raw, "text/csv")}
        return client.post("/api/episodes/import", headers=auth(op), files=files)

    first, second = up(), up()
    assert first.status_code == second.status_code == 200
    assert first.json()["imported"] > 0 and second.json()["imported"] == 0


def test_upload_endpoint_rejects_bad_files(client, make):
    op = make.user("operator")
    r = client.post(
        "/api/episodes/import",
        headers=auth(op),
        files={"file": ("e.csv", b"a,b\n1,2\n", "text/csv")},
    )
    assert r.status_code == 422 and "Missing required column" in r.json()["detail"]
