"""Operational commands:  python -m app.cli <command>

seed-users [--file PATH]     create the users listed in a JSON file (existing emails are skipped)
import-episodes PATH         import an episode CSV (safe to repeat)
"""

import argparse
import json
import sys

from sqlalchemy import func, select

from app.config import get_settings
from app.db import session_factory
from app.logging_config import configure_logging
from app.models import User
from app.security import hash_password
from app.services.importer import FatalImportError, import_episodes


def seed_users(path: str) -> int:
    with open(path, encoding="utf-8") as fh:
        users = json.load(fh)
    created = skipped = 0
    with session_factory()() as db:
        for u in users:
            email = u["email"].strip().lower()
            if db.scalar(select(User.id).where(func.lower(User.email) == email)):
                skipped += 1
                continue
            db.add(
                User(
                    email=email,
                    name=u["name"],
                    organisation=u.get("organisation"),
                    role=u["role"],
                    password_hash=hash_password(u["password"]),
                )
            )
            created += 1
        db.commit()
    print(f"users: {created} created, {skipped} already existed")
    return 0


def import_file(path: str) -> int:
    with session_factory()() as db, open(path, "rb") as fh:
        try:
            report = import_episodes(db, fh, filename=path.rsplit("/", 1)[-1])
        except FatalImportError as exc:
            print(f"import failed: {exc}", file=sys.stderr)
            return 1
    print(
        f"episodes: {report['imported']} imported, {report['skipped']} skipped of {report['rows_total']} rows"
    )
    for reason, count in sorted(report["skipped_by_reason"].items()):
        print(f"  skipped {count:>4}  {reason}")
    for kind, count in sorted(report["normalizations"].items()):
        print(f"  fixed   {count:>4}  {kind}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p_seed = sub.add_parser("seed-users")
    p_seed.add_argument("--file", default="/seed/users.json")
    p_imp = sub.add_parser("import-episodes")
    p_imp.add_argument("path")
    args = parser.parse_args(argv)

    configure_logging(get_settings().log_level)
    if args.command == "seed-users":
        return seed_users(args.file)
    return import_file(args.path)


if __name__ == "__main__":
    raise SystemExit(main())
