#!/usr/bin/env python3
"""Remove low-quality generated chair-flying entries, fix completeness, and validate."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

from knowledge_validation import (
    GENERATED_CATEGORIES,
    audit_entries,
    check_entry_audit,
    check_entry_completeness,
    classify_value_kind,
    fix_bad_labels,
    fix_garbage_questions,
    normalize,
    pick_same_kind_distractors,
    strip_page_refs,
    validate_entries,
)

PHASE_NAMES = {
    "takeoff": "takeoff",
    "climb": "climb",
    "level flight": "level flight",
    "level": "level flight",
    "descend": "descent",
    "turns": "turns",
    "downwind": "downwind",
    "base": "base leg",
    "final": "final approach",
}

SCRIPTS_DIR = Path(__file__).resolve().parent


def load_generator_module():
    spec = importlib.util.spec_from_file_location(
        "generate_chair_flying_pack",
        SCRIPTS_DIR / "generate-chair-flying-pack.py",
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def rewrite_full_sequence_question(entry: dict) -> str | None:
    question = entry.get("question", "")
    match = re.search(r"Full sequence loop 1, step \d+ \(([^)]+)\):", question)
    if not match:
        return None

    phase = PHASE_NAMES.get(match.group(1).strip().lower(), match.group(1).strip())
    bracket = re.search(r"\[(.+?)\]", question, re.DOTALL)
    if not bracket:
        return None

    inner = re.sub(r"\s+", " ", bracket.group(1).strip()).rstrip("?")
    if not inner:
        return None

    return f"Chair-flying a full circuit at {phase}: {inner}?"


def cleanup_entries(entries: list[dict]) -> tuple[list[dict], dict[str, int]]:
    stats = {
        "removed_generated_categories": 0,
        "removed_redundant_full_sequence_loops": 0,
        "rewritten_full_sequence": 0,
    }
    cleaned: list[dict] = []

    for entry in entries:
        category = entry.get("category", "")
        question = entry.get("question", "")

        if category in GENERATED_CATEGORIES:
            stats["removed_generated_categories"] += 1
            continue

        if category == "Chair Flying - Full Sequence":
            if re.search(r"Full sequence loop [23],", question):
                stats["removed_redundant_full_sequence_loops"] += 1
                continue

            rewritten = rewrite_full_sequence_question(entry)
            if rewritten:
                entry = dict(entry)
                entry["question"] = rewritten
                stats["rewritten_full_sequence"] += 1

        cleaned.append(entry)

    return cleaned, stats


def find_anchor(entry: dict, entries: list[dict]) -> dict | None:
    value = str(entry.get("value", "")).strip()
    source = str(entry.get("source", "")).strip()
    if not value or not source:
        return None

    matches = [
        item
        for item in entries
        if str(item.get("value", "")).strip() == value
        and str(item.get("source", "")).strip() == source
        and item.get("category") not in GENERATED_CATEGORIES
        and not str(item.get("category", "")).startswith("Chair Flying")
    ]
    if len(matches) == 1:
        return matches[0]
    if matches:
        return matches[0]
    return None


def template_index_from_label(label: str, template_count: int) -> int:
    level_match = re.search(r"\bL(\d+)\b", label)
    loop_match = re.search(r"\bloop (\d+)\b", label, re.I)
    level = int(level_match.group(1)) if level_match else 1
    loop = int(loop_match.group(1)) if loop_match else 1
    return (level + loop) % max(template_count, 1)


def fix_completeness(entries: list[dict]) -> dict[str, int]:
    stats = {
        "fixed_labels": 0,
        "rewritten_generated_questions": 0,
        "updated_generated_labels": 0,
        "fixed_garbage_questions": 0,
    }
    stats["fixed_labels"] = fix_bad_labels(entries)
    stats["fixed_garbage_questions"] = fix_garbage_questions(entries)

    generator = load_generator_module()
    seen_questions: set[str] = {
        generator.normalize(str(entry.get("question", "")))
        for entry in entries
        if str(entry.get("question", "")).strip()
    }

    for entry in entries:
        issues = check_entry_completeness(entry)
        if not issues:
            continue

        category = str(entry.get("category", "")).strip()
        if category not in GENERATED_CATEGORIES:
            continue

        context_issues = [issue for issue in issues if "context slot" in issue]
        if not context_issues:
            continue

        anchor = find_anchor(entry, entries)
        if not anchor:
            continue

        templates = generator.QUESTION_TEMPLATES.get((category, entry.get("type", "")))
        if not templates:
            continue

        old_key = generator.normalize(str(entry.get("question", "")))
        start_idx = template_index_from_label(str(entry.get("label", "")), len(templates))
        new_question = None

        for offset in range(len(templates)):
            template_idx = (start_idx + offset) % len(templates)
            candidate = generator.compact_question(
                templates[template_idx].format(
                    anchor_context=generator.anchor_context(anchor),
                    anchor_label=anchor["label"],
                    anchor_question=generator.compact_question(anchor["question"]),
                    source=anchor["source"],
                )
            )
            candidate_key = generator.normalize(candidate)
            if candidate_key == old_key:
                continue
            if candidate_key in seen_questions:
                continue
            if check_entry_completeness({**entry, "question": candidate}):
                continue
            new_question = candidate
            break

        if not new_question:
            continue

        seen_questions.discard(old_key)
        entry["question"] = new_question
        seen_questions.add(generator.normalize(new_question))

        old_label = str(entry.get("label", ""))
        if " - " in old_label:
            prefix = old_label.rsplit(" - ", 1)[0]
            entry["label"] = f"{prefix} - {anchor['label']}"
            stats["updated_generated_labels"] += 1

        stats["rewritten_generated_questions"] += 1

    return stats


def fix_audit_issues(entries: list[dict]) -> dict[str, int]:
    """Rewrite questions and distractors flagged by the quality audit."""
    stats = {
        "stripped_page_refs": 0,
        "fixed_distractors": 0,
        "removed_unsalvageable": 0,
    }

    kind_pools: dict[str, list[str]] = {}
    for entry in entries:
        value = str(entry.get("value", "")).strip()
        if not value:
            continue
        kind = classify_value_kind(value)
        kind_pools.setdefault(kind, [])
        if value not in kind_pools[kind]:
            kind_pools[kind].append(value)

    global_values = [str(entry.get("value", "")).strip() for entry in entries if str(entry.get("value", "")).strip()]
    kept: list[dict] = []

    for entry in entries:
        entry_id = str(entry.get("id", "")).strip()
        question = str(entry.get("question", "")).strip()
        cleaned_question = strip_page_refs(question)
        if cleaned_question != question:
            entry["question"] = cleaned_question
            question = cleaned_question
            stats["stripped_page_refs"] += 1

        issues = check_entry_audit(entry)
        distractor_issues = [issue for issue in issues if "distractor" in issue]
        if distractor_issues:
            value = str(entry.get("value", "")).strip()
            kind = classify_value_kind(value)
            pool = kind_pools.get(kind) or global_values
            seed = f"fix|{entry_id}|{value}"
            new_distractors = pick_same_kind_distractors(value, pool, seed, count=3, existing=[])
            if len(new_distractors) == 3 and not check_entry_audit({**entry, "distractors": new_distractors}):
                entry["distractors"] = new_distractors
                stats["fixed_distractors"] += 1
                issues = check_entry_audit(entry)

        if issues and str(entry.get("category", "")) in GENERATED_CATEGORIES:
            stats["removed_unsalvageable"] += 1
            continue

        kept.append(entry)

    entries.clear()
    entries.extend(kept)
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="data/dv20-knowledge.json")
    parser.add_argument("--output", default="data/dv20-knowledge.json")
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate the input file without removing generated categories",
    )
    parser.add_argument(
        "--fix-completeness",
        action="store_true",
        help="Apply safe completeness fixes (labels and generated question rewrites)",
    )
    parser.add_argument(
        "--fix-audit",
        action="store_true",
        help="Strip page refs, fix distractor types, and drop unsalvageable generated entries",
    )
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input)
    with input_path.open("r", encoding="utf-8") as handle:
        entries = json.load(handle)

    if not isinstance(entries, list):
        raise RuntimeError("Expected a JSON array of entries")

    original_count = len(entries)
    fix_stats: dict[str, int] = {}

    if args.validate_only:
        cleaned = entries
        stats = {
            "removed_generated_categories": 0,
            "removed_redundant_full_sequence_loops": 0,
            "rewritten_full_sequence": 0,
        }
    else:
        cleaned, stats = cleanup_entries(entries)

    if args.fix_completeness:
        fix_stats = fix_completeness(cleaned)

    audit_stats: dict[str, int] = {}
    if args.fix_audit:
        audit_stats = fix_audit_issues(cleaned)

    errors = validate_entries(cleaned)
    audit_issues, _reason_counts = audit_entries(cleaned)

    print(f"original_entries={original_count}")
    print(f"validated_entries={len(cleaned)}")
    if not args.validate_only:
        print(f"removed_total={original_count - len(cleaned)}")
        for key, value in stats.items():
            print(f"{key}={value}")
    if fix_stats:
        for key, value in fix_stats.items():
            print(f"{key}={value}")
    if audit_stats:
        for key, value in audit_stats.items():
            print(f"{key}={value}")
    print(f"validation_errors={len(errors)}")
    print(f"audit_issues={len(audit_issues)}")
    for error in errors[:20]:
        print(f"  - {error}")
    if len(errors) > 20:
        print(f"  ... and {len(errors) - 20} more")

    if args.write:
        output_path = Path(args.output)
        with output_path.open("w", encoding="utf-8") as handle:
            json.dump(cleaned, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        print(f"wrote={output_path}")

    return 1 if errors or audit_issues else 0


if __name__ == "__main__":
    sys.exit(main())
