from itertools import chain


class CircularBuffer:
    """Fixed-size FIFO that retains the most recent items in insertion order."""

    def __init__(self, capacity):
        if capacity < 1:
            raise ValueError("Capacity must be positive.")
        self._items = [None] * capacity
        self._next = 0
        self._size = 0

    def append(self, value):
        self._items[self._next] = value
        self._next = (self._next + 1) % len(self._items)
        self._size = min(self._size + 1, len(self._items))

    def __iter__(self):
        for offset in range(self._size):
            yield self._items[(self._next - self._size + offset) % len(self._items)]


def merge_ordered(left, right, *, key):
    """Merge two ascending streams in linear time and constant auxiliary space."""
    left, right = iter(left), iter(right)
    sentinel = object()
    a, b = next(left, sentinel), next(right, sentinel)
    while a is not sentinel and b is not sentinel:
        if key(a) <= key(b):
            yield a
            a = next(left, sentinel)
        else:
            yield b
            b = next(right, sentinel)
    yield from chain(() if a is sentinel else (a,), left, () if b is sentinel else (b,), right)
