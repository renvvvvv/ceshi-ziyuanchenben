"""Input schema definition and validation for resource_plan.py parameters."""

from __future__ import annotations

REQUIRED_FIELDS = [
    "total_mw", "total_duration", "cabinet_power",
    "total_cabinets", "ac_type", "it_transformers", "power_transformers",
]

OPTIONAL_FIELDS = [
    "hybrid_transformers", "tight_schedule",
    "parallel_it", "parallel_power", "parallel_hybrid",
]

FIELD_CONSTRAINTS = {
    "total_mw":            {"type": float, "min": 0.1, "max": 1000.0},
    "total_duration":      {"type": int,   "min": 1,   "max": 365},
    "cabinet_power":       {"type": "int_or_list"},
    "total_cabinets":      {"type": int,   "min": 1,   "max": 100000},
    "ac_type":             {"type": str},
    "it_transformers":     {"type": "transformer_list"},
    "power_transformers":  {"type": "transformer_list"},
    "hybrid_transformers": {"type": "transformer_list", "nullable": True},
    "tight_schedule":      {"type": bool,  "nullable": True},
    "parallel_it":         {"type": int,   "min": 1, "max": 10, "nullable": True},
    "parallel_power":      {"type": int,   "min": 1, "max": 10, "nullable": True},
    "parallel_hybrid":     {"type": int,   "min": 1, "max": 10, "nullable": True},
}

ALL_FIELDS = REQUIRED_FIELDS + OPTIONAL_FIELDS


def _check_cabinet_power(value, warnings: list[str]):
    if isinstance(value, (int, float)):
        if value <= 0:
            warnings.append(f"cabinet_power should be > 0, got {value}")
        return
    if isinstance(value, list):
        for i, item in enumerate(value):
            if not (isinstance(item, list) and len(item) == 2):
                warnings.append(f"cabinet_power[{i}]: expected [power, count] pair, got {item}")
                continue
            p, c = item
            if not isinstance(p, (int, float, str)):
                warnings.append(f"cabinet_power[{i}]: power should be number, got {type(p).__name__}")
            if not isinstance(c, int) or c <= 0:
                warnings.append(f"cabinet_power[{i}]: count should be positive int, got {c}")
        return
    warnings.append(f"cabinet_power: expected int or list, got {type(value).__name__}")


def _check_transformer_list(field: str, value, warnings: list[str]):
    if not isinstance(value, list):
        warnings.append(f"{field}: expected list, got {type(value).__name__}")
        return
    for i, item in enumerate(value):
        if not (isinstance(item, list) and len(item) == 2):
            warnings.append(f"{field}[{i}]: expected [capacity_str, count_int], got {item}")
            continue
        cap, cnt = item
        if not isinstance(cap, (str, int, float)):
            warnings.append(f"{field}[{i}]: capacity should be string, got {type(cap).__name__}")
        if not isinstance(cnt, int) or cnt <= 0:
            warnings.append(f"{field}[{i}]: count should be positive int, got {cnt}")


def _check_scalar(field: str, value, constraint: dict, warnings: list[str]):
    expected = constraint["type"]
    if expected == float and isinstance(value, int):
        pass  # int is acceptable for float fields
    elif not isinstance(value, expected):
        warnings.append(f"{field}: expected {expected.__name__}, got {type(value).__name__}")
        return
    lo = constraint.get("min")
    hi = constraint.get("max")
    if lo is not None and value < lo:
        warnings.append(f"{field}: {value} < min {lo}")
    if hi is not None and value > hi:
        warnings.append(f"{field}: {value} > max {hi}")


def validate_input(data: dict) -> tuple[bool, list[str]]:
    """Validate extracted data against the resource_plan.py input schema.

    Returns (is_valid, warnings).  is_valid means all required fields present.
    """
    warnings: list[str] = []

    # Check required fields are present and non-null
    for field in REQUIRED_FIELDS:
        if field not in data or data[field] is None:
            warnings.append(f"Missing required field: {field}")

    # Type and range checks for present fields
    for field, value in data.items():
        if value is None:
            continue
        if field not in FIELD_CONSTRAINTS:
            continue
        constraint = FIELD_CONSTRAINTS[field]

        if field == "cabinet_power":
            _check_cabinet_power(value, warnings)
        elif constraint["type"] == "transformer_list":
            _check_transformer_list(field, value, warnings)
        elif constraint["type"] in (int, float):
            _check_scalar(field, value, constraint, warnings)

    # Cross-field: total_cabinets must exist when cabinet_power is scalar
    cp = data.get("cabinet_power")
    tc = data.get("total_cabinets")
    if isinstance(cp, (int, float)) and cp > 0 and (tc is None or tc <= 0):
        warnings.append("total_cabinets is required when cabinet_power is a single value")

    is_valid = not any(w.startswith("Missing required field:") for w in warnings)
    return is_valid, warnings
