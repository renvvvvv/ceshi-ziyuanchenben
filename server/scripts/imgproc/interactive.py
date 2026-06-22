"""Interactive field-by-field editor for extracted parameters."""

import json


def _parse_value(field: str, raw: str):
    """Parse user input into the correct Python type for the given field."""
    raw = raw.strip()
    if raw == "" or raw.lower() == "none":
        return None
    if field == "tight_schedule":
        return raw.lower() in ("true", "1", "yes")
    if field in ("total_duration", "total_cabinets",
                 "parallel_it", "parallel_power", "parallel_hybrid"):
        return int(raw)
    if field == "total_mw":
        return float(raw)
    if field == "cabinet_power":
        try:
            return int(raw)
        except ValueError:
            try:
                return float(raw)
            except ValueError:
                return json.loads(raw)
    if field in ("it_transformers", "power_transformers", "hybrid_transformers"):
        return json.loads(raw)
    if field == "ac_type":
        return raw
    return raw


def interactive_edit(data: dict) -> dict:
    """Show extracted data, allow field-by-field editing, return modified dict."""

    print("\n=== Extracted Parameters ===")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    print("=============================")
    print("Enter field=new_value to edit, or press Enter to accept.")
    print("Example: total_mw=30.0")
    print("Enter 'none' to set a field to null.\n")

    while True:
        try:
            cmd = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not cmd:
            break

        if "=" not in cmd:
            print("  Format: field_name=new_value")
            continue

        field, raw_val = cmd.split("=", 1)
        field = field.strip()

        try:
            value = _parse_value(field, raw_val)
            data[field] = value
            print(f"  {field} = {json.dumps(value, ensure_ascii=False)}")
        except (ValueError, json.JSONDecodeError) as e:
            print(f"  Error: {e}")

    return data
