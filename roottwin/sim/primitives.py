"""Small SimPy building blocks used by the factory (no domain logic here)."""
from __future__ import annotations

from collections import deque
from typing import Any

import simpy


class Buffer:
    """FIFO buffer whose capacity can change while the simulation runs (`set_buffer` command).

    put(item) / get() return SimPy events, like simpy.Store. Capacity 0 means "no buffer":
    a part is handed over only when the machine is ready to take it. Lowering the capacity
    below the current content keeps the parts already inside; no new part enters until
    the level is below the new capacity.
    """

    def __init__(self, env: simpy.Environment, capacity: int):
        self.env = env
        self.capacity = int(capacity)
        self.items: deque[Any] = deque()
        self._getters: deque[simpy.Event] = deque()
        self._putters: deque[tuple[simpy.Event, Any]] = deque()

    def __len__(self) -> int:
        return len(self.items)

    def put(self, item: Any) -> simpy.Event:
        ev = self.env.event()
        self._putters.append((ev, item))
        self._dispatch()
        return ev

    def get(self) -> simpy.Event:
        ev = self.env.event()
        self._getters.append(ev)
        self._dispatch()
        return ev

    def set_capacity(self, capacity: int) -> None:
        self.capacity = int(capacity)
        self._dispatch()

    def _dispatch(self) -> None:
        while True:
            if self._getters and self.items:
                self._getters.popleft().succeed(self.items.popleft())
            elif self._putters and len(self.items) < self.capacity:
                ev, item = self._putters.popleft()
                self.items.append(item)
                ev.succeed()
            elif self._getters and self._putters:  # direct hand-over (capacity 0)
                ev, item = self._putters.popleft()
                self._getters.popleft().succeed(item)
                ev.succeed()
            else:
                return


class Gate:
    """Open/closed flag a process can wait on, in both directions.

    A machine works only while its gate is open; while working it waits for
    `timeout | gate.closed()` so a failure or a stop interrupts the cycle cleanly
    (no simpy.Interrupt, so no half-consumed buffer events).
    """

    def __init__(self, env: simpy.Environment, is_open: bool = True):
        self.env = env
        self.is_open = is_open
        self._opened = env.event()
        self._closed = env.event()

    def opened(self) -> simpy.Event:
        return self._opened

    def closed(self) -> simpy.Event:
        return self._closed

    def set(self, is_open: bool) -> None:
        if is_open == self.is_open:
            return
        self.is_open = is_open
        if is_open:
            ev, self._opened = self._opened, self.env.event()
        else:
            ev, self._closed = self._closed, self.env.event()
        ev.succeed()


class Signal:
    """Wake-up call: wait() returns an event that fires at the next fire()."""

    def __init__(self, env: simpy.Environment):
        self.env = env
        self._ev = env.event()

    def wait(self) -> simpy.Event:
        return self._ev

    def fire(self) -> None:
        ev, self._ev = self._ev, self.env.event()
        ev.succeed()


class TimeShare:
    """Accumulated simulated time during which a condition was true (downtime, uptime...)."""

    def __init__(self, env: simpy.Environment, on: bool = False):
        self.env = env
        self.on = on
        self._acc = 0.0
        self._since = env.now

    def set(self, on: bool) -> None:
        if on == self.on:
            return
        self._acc = self.total()
        self._since = self.env.now
        self.on = on

    def total(self) -> float:
        return self._acc + (self.env.now - self._since if self.on else 0.0)
