"""AI image recognition backends for data center parameter extraction."""

_backends: dict[str, type] = {}


def register_backend(name: str, cls: type) -> None:
    _backends[name] = cls


def get_backend(name: str, **kwargs):
    if name not in _backends:
        raise ValueError(f"Unknown backend '{name}'. Available: {list(_backends)}")
    return _backends[name](**kwargs)
