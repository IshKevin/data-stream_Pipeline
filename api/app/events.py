"""In-process pub/sub used by the Server-Sent Events endpoint.

Single-process only: with several API replicas, publish through Postgres
LISTEN/NOTIFY or Redis instead (see NOTES.md).
"""

import asyncio
import contextlib
import threading
from dataclasses import dataclass


@dataclass(frozen=True)
class Subscriber:
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue
    user_id: int
    is_staff: bool


class EventBroker:
    def __init__(self) -> None:
        self._subs: set[Subscriber] = set()
        self._lock = threading.Lock()

    def subscribe(self, user_id: int, is_staff: bool) -> Subscriber:
        sub = Subscriber(asyncio.get_running_loop(), asyncio.Queue(maxsize=100), user_id, is_staff)
        with self._lock:
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        with self._lock:
            self._subs.discard(sub)

    def publish(self, event: dict, *, client_id: int) -> None:
        """Thread-safe; called from sync request handlers running in the threadpool.
        Staff see every event, a client only sees events about their own requests."""
        with self._lock:
            targets = [s for s in self._subs if s.is_staff or s.user_id == client_id]
        for sub in targets:
            sub.loop.call_soon_threadsafe(self._offer, sub.queue, event)

    @staticmethod
    def _offer(queue: asyncio.Queue, event: dict) -> None:
        # slow consumer: drop the event; the UI also refetches on reconnect
        with contextlib.suppress(asyncio.QueueFull):
            queue.put_nowait(event)


broker = EventBroker()
