"""Pure rules for the request workflow. No database access, so it's trivially testable.

submitted -> in_progress -> delivered -> accepted
                                     \\-> rejected -> in_progress (rework)
"""

SUBMITTED = "submitted"
IN_PROGRESS = "in_progress"
DELIVERED = "delivered"
ACCEPTED = "accepted"
REJECTED = "rejected"

STAFF = frozenset({"operator", "admin"})
CLIENT = frozenset({"client"})

# (from_status, to_status) -> roles allowed to perform the step
TRANSITIONS: dict[tuple[str, str], frozenset[str]] = {
    (SUBMITTED, IN_PROGRESS): STAFF,
    (IN_PROGRESS, DELIVERED): STAFF,
    (DELIVERED, ACCEPTED): CLIENT,
    (DELIVERED, REJECTED): CLIENT,
    (REJECTED, IN_PROGRESS): STAFF,
}

# While a request is in these states operators may add/remove episodes.
ASSIGNABLE_STATUSES = frozenset({SUBMITTED, IN_PROGRESS})

ASSIGNABLE_QUALITIES = frozenset({"good", "usable"})


def transition_roles(from_status: str, to_status: str) -> frozenset[str] | None:
    """Roles allowed to make this move, or None if the move doesn't exist at all."""
    return TRANSITIONS.get((from_status, to_status))


def available_transitions(status: str, role: str) -> list[str]:
    """Target statuses that a user with `role` may move a request in `status` to.
    (Ownership of the request by a client is checked separately, in the service.)"""
    return [to for (frm, to), roles in TRANSITIONS.items() if frm == status and role in roles]
