import asyncio
import json

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.deps import streaming_user
from app.events import broker
from app.models import User

router = APIRouter(tags=["events"])

HEARTBEAT_SECONDS = 15


@router.get("/events")
async def events(request: Request, user: User = Depends(streaming_user)):
    """Server-Sent Events stream of request changes the caller is allowed to see.

    The browser's EventSource cannot send an Authorization header, so the web app
    consumes this endpoint with fetch() streaming instead (see web/src/lib/sse.ts)."""
    sub = broker.subscribe(user.id, user.role in ("operator", "admin"))

    async def stream():
        try:
            yield "retry: 3000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(sub.queue.get(), timeout=HEARTBEAT_SECONDS)
                    yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
                except TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            broker.unsubscribe(sub)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
