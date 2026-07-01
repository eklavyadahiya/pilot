"""Shared completeness validation for DV20 knowledge bank entries."""

from __future__ import annotations

import re

SCHEMA_KEYS = {
    "id",
    "category",
    "type",
    "label",
    "value",
    "note",
    "source",
    "question",
    "distractors",
}

GENERATED_CATEGORIES = {
    "Chair Flying - Phase Decision Drills",
    "Chair Flying - If Then Traps",
    "Chair Flying - Radio Timing & Calls",
    "Chair Flying - Emergency Pressure Loops",
}

CHAIR_FLYING_PREFIXES = (
    "At ",
    "For ",
    "In ",
    "While chair-flying ",
    "When reaching ",
    "Under time pressure at ",
    "In a high-workload branch at ",
    "If workload spikes at ",
    "With this cue at ",
    "If this trigger appears under pressure at ",
    "If this checklist cue is missed at ",
    "If you miss this step at ",
    "If this trigger appears at ",
    "If you notice a problem at ",
    "You are behind profile at ",
    "If workload rises at ",
    "From memory at ",
    "You are chair-flying ",
    "Recall the standard call or action for ",
    "Which reference-standard response applies at ",
    "What call or action should you verbalize for ",
    "At this point in ",
    "For this trigger at ",
)

QUESTION_STARTERS = (
    "What ",
    "When ",
    "Where ",
    "How ",
    "Does ",
    "Is ",
    "Are ",
    "If ",
    "Which ",
    "Who ",
    "Why ",
)

MIN_QUESTION_LEN = 15
MAX_QUESTION_LEN = 280

TRUNCATED_ENDINGS = (":", ",", "-", "[", "(", "...")

MANGLED_LABEL_RE = re.compile(
    r"^(Speed|Altitude)\s+(is|does)\b|^Does leaving\b|^Altitude is\b|^And at what\b",
    re.I,
)

META_LOOP_RE = re.compile(r"Full sequence loop \d+, step \d+", re.I)


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def is_mangled_label(label: str) -> bool:
    cleaned = re.sub(r"\s+", " ", str(label or "").strip())
    return bool(MANGLED_LABEL_RE.match(cleaned))


def balanced_brackets(text: str) -> bool:
    depth = 0
    for char in text:
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def balanced_parens(text: str) -> bool:
    depth = 0
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def context_slot_after_prefix(question: str, prefix: str) -> str | None:
    idx = question.find(prefix)
    if idx < 0:
        return None
    after = question[idx + len(prefix) :]
    for stop in ("?", ".", ","):
        if stop in after:
            after = after[: after.index(stop)]
    return after.strip()


def has_bad_context_slot(question: str, category: str) -> bool:
    if category not in GENERATED_CATEGORIES:
        return False

    for prefix in CHAIR_FLYING_PREFIXES:
        slot = context_slot_after_prefix(question, prefix)
        if not slot:
            continue
        if slot.startswith(QUESTION_STARTERS):
            return True
        if is_mangled_label(slot):
            return True
    return False


def answer_leaks_into_question(question: str, value: str) -> bool:
    cleaned_value = str(value or "").strip()
    if len(cleaned_value) < 4:
        return False
    value_key = normalize(cleaned_value)
    if not value_key or len(value_key.split()) > 6:
        return False
    question_key = normalize(question)
    if value_key not in question_key:
        return False
    value_words = value_key.split()
    if len(value_words) == 1 and value_words[0] in {
        "student",
        "training",
        "glider",
        "tower",
        "full",
        "off",
        "on",
        "up",
        "down",
    }:
        return False
    return True


def check_entry_completeness(entry: dict) -> list[str]:
    """Return human-readable completeness issues for one entry."""
    issues: list[str] = []
    entry_id = str(entry.get("id", "")).strip() or "?"

    for field in ("category", "label", "source", "question", "value"):
        if not str(entry.get(field, "")).strip():
            issues.append(f"{entry_id}: empty {field}")

    question = str(entry.get("question", "")).strip()
    value = str(entry.get("value", "")).strip()
    category = str(entry.get("category", "")).strip()

    if not question:
        return issues

    if len(question) < MIN_QUESTION_LEN:
        issues.append(f"{entry_id}: question too short ({len(question)} chars)")

    if len(question) > MAX_QUESTION_LEN:
        issues.append(f"{entry_id}: question too long ({len(question)} chars)")

    if not question.endswith("?"):
        issues.append(f"{entry_id}: question must end with '?'")

    stripped = question.rstrip()
    for ending in TRUNCATED_ENDINGS:
        if stripped.endswith(ending):
            issues.append(f"{entry_id}: question looks truncated (ends with '{ending}')")
            break

    if "??" in question:
        issues.append(f"{entry_id}: question contains '??'")

    if not balanced_brackets(question):
        issues.append(f"{entry_id}: unclosed square brackets")

    if not balanced_parens(question):
        issues.append(f"{entry_id}: unclosed parentheses")

    if META_LOOP_RE.search(question):
        issues.append(f"{entry_id}: question contains full-sequence meta text")

    bracket_match = re.search(r"\[([^\]]+)\]", question)
    if bracket_match and len(bracket_match.group(1)) > 120:
        issues.append(f"{entry_id}: nested bracket content too long")

    if has_bad_context_slot(question, category):
        issues.append(f"{entry_id}: chair-flying context slot is incomplete or malformed")

    if answer_leaks_into_question(question, value):
        issues.append(f"{entry_id}: correct answer appears verbatim in question")

    distractors = entry.get("distractors")
    if isinstance(distractors, list):
        normalized_values = {normalize(value)} if value else set()
        for distractor in distractors:
            cleaned = str(distractor or "").strip()
            if not cleaned:
                issues.append(f"{entry_id}: empty distractor")
                continue
            key = normalize(cleaned)
            if key in normalized_values:
                issues.append(f"{entry_id}: duplicate answer/distractor '{cleaned}'")
            normalized_values.add(key)

    return issues


def validate_schema(entry: dict, index: int, seen_ids: set[str], seen_questions: set[str]) -> list[str]:
    """Structural validation (schema, ids, duplicates)."""
    errors: list[str] = []
    prefix = f"entry[{index}]"
    entry_id = str(entry.get("id", "")).strip()

    if set(entry.keys()) != SCHEMA_KEYS:
        errors.append(f"{prefix}: schema keys mismatch ({sorted(entry.keys())})")
        return errors

    if not entry_id:
        errors.append(f"{prefix}: missing id")
    elif entry_id in seen_ids:
        errors.append(f"{prefix}: duplicate id {entry_id}")
    else:
        seen_ids.add(entry_id)

    question = str(entry.get("question", "")).strip()
    question_key = normalize(question)
    if question_key:
        if question_key in seen_questions:
            errors.append(f"{prefix} {entry_id}: duplicate question")
        else:
            seen_questions.add(question_key)

    distractors = entry.get("distractors")
    if not isinstance(distractors, list) or len(distractors) != 3:
        errors.append(f"{prefix} {entry_id}: expected exactly 3 distractors")

    return errors


def validate_entries(entries: list[dict]) -> list[str]:
    """Full validation: schema + completeness."""
    errors: list[str] = []
    seen_ids: set[str] = set()
    seen_questions: set[str] = set()

    for index, entry in enumerate(entries):
        errors.extend(validate_schema(entry, index, seen_ids, seen_questions))
        errors.extend(check_entry_completeness(entry))

    return errors


def is_complete_entry(entry: dict) -> bool:
    return not check_entry_completeness(entry)


def source_context(source: str) -> str:
    cleaned = str(source or "").strip()
    if " - " in cleaned:
        return cleaned.split(" - ", 1)[-1].strip().rstrip(".")
    return cleaned.rstrip(".")


def anchor_context(anchor: dict) -> str:
    """Derive a short phase/context phrase from an anchor entry."""
    label = re.sub(r"\s+", " ", str(anchor.get("label", "")).strip()).rstrip("?")
    question = re.sub(r"\s+", " ", str(anchor.get("question", "")).strip()).rstrip("?")
    context_from_source = source_context(str(anchor.get("source", "")))

    if is_mangled_label(label):
        return context_from_source or question or "this phase"

    lowered = label.lower()
    if len(label) > 60 or lowered.startswith(
        ("what ", "when ", "where ", "how ", "during ", "if ", "in ", "does ", "and ", "up to ")
    ):
        return context_from_source or question or "this phase"

    if label:
        return label
    return context_from_source or question or "this phase"


# Safe auto-fixes for known mangled source labels (id -> corrected label).
LABEL_FIXES: dict[str, str] = {
    "DV20-046": "Slow flight target speed",
    "DV20-055": "Standard circuit altitude (uncontrolled)",
    "DV20-056": "Circuit area vertical extent",
    "DV20-057": "Standard circuit join point and angle",
    "DV20-058": "Circuit departure point",
}


def apply_label_fixes(entries: list[dict]) -> int:
    fixed = 0
    for entry in entries:
        entry_id = str(entry.get("id", "")).strip()
        if entry_id in LABEL_FIXES:
            entry["label"] = LABEL_FIXES[entry_id]
            fixed += 1
    return fixed
