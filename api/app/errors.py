class DomainError(Exception):
    """A rule violation that should be reported to the caller as a 4xx response."""

    status_code = 400
    code = "domain_error"

    def __init__(self, message: str, *, details: list[dict] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details


class NotFound(DomainError):
    status_code = 404
    code = "not_found"


class Forbidden(DomainError):
    status_code = 403
    code = "forbidden"


class Unauthorized(DomainError):
    status_code = 401
    code = "unauthorized"


class Conflict(DomainError):
    status_code = 409
    code = "conflict"


class Invalid(DomainError):
    status_code = 422
    code = "invalid"
