#!/usr/bin/env python3
"""Deterministically generate and merge a chair-flying expansion pack."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from knowledge_validation import (
    STRUCTURED_VALUE_KINDS,
    anchor_context,
    check_entry_audit,
    check_semantic_match,
    classify_anchor,
    classify_value_kind,
    effective_label,
    is_complete_entry,
    is_radio_anchor,
    is_verbal_callout_anchor,
    normalize,
    pick_same_kind_distractors,
)


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

EXCLUDED_ANCHOR_CATEGORIES = GENERATED_CATEGORIES | {
    "Chair Flying - Full Sequence",
    "Chair Flying - Mental Flows",
    "Chair Flying - Phase Actions",
}

CATEGORY_MATRIX = [
    {
        "category": "Chair Flying - Phase Decision Drills",
        "type_targets": {"scenario": 150, "procedure": 70, "mental": 30},
        "label_prefix": "Phase decision",
        "note": "Phase-oriented chair-flying decision loop.",
    },
    {
        "category": "Chair Flying - If Then Traps",
        "type_targets": {"scenario": 140, "procedure": 70, "checklist": 40},
        "label_prefix": "If/then trap",
        "note": "If/then trap recognition and correction loop.",
    },
    {
        "category": "Chair Flying - Radio Timing & Calls",
        "type_targets": {"mental": 110, "scenario": 80, "reference": 60},
        "label_prefix": "Radio timing",
        "note": "Verbal timing and call discipline loop.",
    },
    {
        "category": "Chair Flying - Emergency Pressure Loops",
        "type_targets": {"scenario": 150, "procedure": 60, "checklist": 40},
        "label_prefix": "Emergency pressure",
        "note": "High-workload branch and recovery loop.",
    },
]

QUESTION_TEMPLATES = {
    ("Chair Flying - Phase Decision Drills", "scenario"): [
        "You are chair-flying {anchor_context}. {anchor_question}",
        "At this point in {anchor_context}, {anchor_question}",
        "While chair-flying {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - Phase Decision Drills", "procedure"): [
        "In {anchor_context}, which procedure step applies: {anchor_question}",
        "For {anchor_context}, what is the required action for: {anchor_question}",
        "At {anchor_context}, what procedure step matches this cue: {anchor_question}",
    ],
    ("Chair Flying - Phase Decision Drills", "mental"): [
        "From memory at {anchor_context}: {anchor_question}",
        "While chair-flying {anchor_context}, recall: {anchor_question}",
    ],
    ("Chair Flying - If Then Traps", "scenario"): [
        "If you notice a problem at {anchor_context}, {anchor_question}",
        "You are behind profile at {anchor_context}. {anchor_question}",
        "If workload rises at {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - If Then Traps", "procedure"): [
        "If this trigger appears at {anchor_context}, {anchor_question}",
        "At {anchor_context}, which action avoids the trap for: {anchor_question}",
        "If you miss this step at {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - If Then Traps", "checklist"): [
        "If this checklist cue is missed at {anchor_context}, {anchor_question}",
        "At {anchor_context}, which checklist response applies: {anchor_question}",
        "During chair-flying at {anchor_context}, if you skip this checklist item: {anchor_question}",
        "While chair-flying at {anchor_context}, after missing this checklist cue: {anchor_question}",
    ],
    ("Chair Flying - Radio Timing & Calls", "mental"): [
        "While chair-flying {anchor_context}, {anchor_question}",
        "At {anchor_context}, recall: {anchor_question}",
        "From memory while chair-flying {anchor_context}: {anchor_question}",
        "During chair-flying at {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - Radio Timing & Calls", "scenario"): [
        "At {anchor_context}, {anchor_question}",
        "When reaching {anchor_context}, {anchor_question}",
        "You are chair-flying {anchor_context}. {anchor_question}",
        "In the {anchor_context} phase, {anchor_question}",
    ],
    ("Chair Flying - Radio Timing & Calls", "reference"): [
        "From memory for {anchor_context}: {anchor_question}",
        "Which standard applies at {anchor_context}? {anchor_question}",
        "Recall for {anchor_context}: {anchor_question}",
        "Reference check at {anchor_context}: {anchor_question}",
    ],
    ("Chair Flying - Emergency Pressure Loops", "scenario"): [
        "Under time pressure at {anchor_context}, {anchor_question}",
        "In a high-workload branch at {anchor_context}, {anchor_question}",
        "If workload spikes at {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - Emergency Pressure Loops", "procedure"): [
        "For this trigger at {anchor_context}, {anchor_question}",
        "At {anchor_context}, what emergency step applies: {anchor_question}",
    ],
    ("Chair Flying - Emergency Pressure Loops", "checklist"): [
        "With this cue at {anchor_context}, {anchor_question}",
        "If this trigger appears under pressure at {anchor_context}, {anchor_question}",
        "Under pressure at {anchor_context}, which checklist step applies: {anchor_question}",
    ],
}

KIND_TEMPLATES = {
    ("Chair Flying - Phase Decision Drills", "scenario", "speed"): [
        "You are chair-flying {anchor_context}. {anchor_question}",
        "At this point in {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - Phase Decision Drills", "scenario", "numeric"): [
        "You are chair-flying {anchor_context}. {anchor_question}",
        "At this point in {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - Phase Decision Drills", "procedure", "speed"): [
        "For {anchor_context}, {anchor_question}",
        "In {anchor_context}, confirm the procedure: {anchor_question}",
    ],
    ("Chair Flying - Phase Decision Drills", "procedure", "numeric"): [
        "For {anchor_context}, {anchor_question}",
        "In {anchor_context}, confirm the procedure: {anchor_question}",
    ],
    ("Chair Flying - Phase Decision Drills", "mental", "speed"): [
        "From memory at {anchor_context}: {anchor_question}",
        "While chair-flying {anchor_context}, recall: {anchor_question}",
    ],
    ("Chair Flying - If Then Traps", "scenario", "speed"): [
        "If you notice a problem at {anchor_context}, {anchor_question}",
        "You are behind profile at {anchor_context}. {anchor_question}",
    ],
    ("Chair Flying - If Then Traps", "procedure", "speed"): [
        "If this trigger appears at {anchor_context}, {anchor_question}",
        "If you miss this step at {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - If Then Traps", "checklist", "checklist"): [
        "If this checklist cue is missed at {anchor_context}, {anchor_question}",
        "At {anchor_context}, which checklist response applies: {anchor_question}",
    ],
    ("Chair Flying - If Then Traps", "checklist", "numeric"): [
        "If this checklist cue is missed at {anchor_context}, {anchor_question}",
        "At {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - Radio Timing & Calls", "mental", "radio"): [
        "What radio call is required at {anchor_context}?",
        "While chair-flying {anchor_context}, what should you transmit?",
        "At {anchor_context}: {anchor_question}",
    ],
    ("Chair Flying - Radio Timing & Calls", "scenario", "radio"): [
        "At {anchor_context}, what radio call is correct?",
        "When reaching {anchor_context}, what should you transmit to ATC?",
    ],
    ("Chair Flying - Radio Timing & Calls", "reference", "radio"): [
        "Recall the standard radio call for {anchor_context}.",
        "Which reference-standard transmission applies at {anchor_context}?",
    ],
    ("Chair Flying - Radio Timing & Calls", "mental", "speed"): [
        "While chair-flying {anchor_context}, what speed do you call out?",
        "At {anchor_context}, what speed do you say aloud?",
    ],
    ("Chair Flying - Radio Timing & Calls", "scenario", "speed"): [
        "When reaching {anchor_context}, what verbal speed callout applies?",
        "At {anchor_context}, what target speed do you verbalize?",
    ],
    ("Chair Flying - Radio Timing & Calls", "reference", "speed"): [
        "Recall the target speed callout for {anchor_context}.",
        "Which reference speed do you verbalize at {anchor_context}?",
    ],
    ("Chair Flying - Radio Timing & Calls", "mental", "numeric"): [
        "While chair-flying {anchor_context}, what do you call out aloud?",
        "At {anchor_context}, what value do you verbalize?",
    ],
    ("Chair Flying - Radio Timing & Calls", "scenario", "numeric"): [
        "When reaching {anchor_context}, what verbal callout is correct?",
        "At {anchor_context}, what do you say aloud to confirm the setting?",
    ],
    ("Chair Flying - Radio Timing & Calls", "reference", "numeric"): [
        "Recall the standard verbal callout for {anchor_context}.",
        "Which reference value do you verbalize at {anchor_context}?",
    ],
    ("Chair Flying - Radio Timing & Calls", "mental", "checklist"): [
        "While chair-flying {anchor_context}, what checklist item do you call out?",
        "At {anchor_context}, what configuration do you verbalize?",
    ],
    ("Chair Flying - Radio Timing & Calls", "scenario", "checklist"): [
        "When reaching {anchor_context}, what checklist callout is correct?",
        "At {anchor_context}, what checklist setting do you say aloud?",
    ],
    ("Chair Flying - Radio Timing & Calls", "reference", "checklist"): [
        "Recall the checklist callout for {anchor_context}.",
        "Which checklist response do you verbalize at {anchor_context}?",
    ],
    ("Chair Flying - Radio Timing & Calls", "mental", "procedure"): [
        "While chair-flying {anchor_context}, what do you say aloud to confirm this step?",
        "At {anchor_context}, what verbal confirmation applies?",
    ],
    ("Chair Flying - Radio Timing & Calls", "scenario", "procedure"): [
        "When reaching {anchor_context}, what do you say to confirm the procedure step?",
        "At {anchor_context}, what spoken confirmation is required?",
    ],
    ("Chair Flying - Emergency Pressure Loops", "scenario", "speed"): [
        "Under time pressure at {anchor_context}, {anchor_question}",
        "In a high-workload branch at {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - Radio Timing & Calls", "reference", "procedure"): [
        "From memory for {anchor_context}: {anchor_question}",
        "Which standard applies at {anchor_context}? {anchor_question}",
    ],
    ("Chair Flying - Radio Timing & Calls", "mental", "other"): [
        "While chair-flying {anchor_context}, {anchor_question}",
        "At {anchor_context}, recall: {anchor_question}",
    ],
    ("Chair Flying - Radio Timing & Calls", "scenario", "other"): [
        "At {anchor_context}, {anchor_question}",
        "When reaching {anchor_context}, {anchor_question}",
    ],
    ("Chair Flying - Radio Timing & Calls", "reference", "other"): [
        "From memory for {anchor_context}: {anchor_question}",
        "Which standard applies at {anchor_context}? {anchor_question}",
    ],
    ("Chair Flying - Emergency Pressure Loops", "procedure", "speed"): [
        "For this trigger at {anchor_context}, {anchor_question}",
        "At {anchor_context} under pressure, {anchor_question}",
    ],
}

INCOMPATIBLE_TEMPLATE_RES = {
    ("Chair Flying - Phase Decision Drills", "procedure"): re.compile(r"\bprocedure step\b", re.I),
    ("Chair Flying - If Then Traps", "checklist"): re.compile(r"\bchecklist response applies\b", re.I),
}

LEVEL_NOTES = {
    1: "Level 1 direct recall.",
    2: "Level 2 ambiguous alternatives.",
    3: "Level 3 sequence continuity.",
}


def stable_index(seed: str, size: int) -> int:
    if size == 0:
        return 0
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest, 16) % size


def compact_question(question: str) -> str:
    cleaned = re.sub(r"\s+", " ", question.strip())
    if not cleaned.endswith("?"):
        cleaned = f"{cleaned.rstrip('.')}?"
    return cleaned


def anchor_question_for_template(anchor: dict) -> str:
    """Use anchor question text without repeating checklist/phase context."""
    question = compact_question(anchor["question"])
    lowered = question.lower()
    if lowered.startswith("on the ") and "checklist" in lowered[:50]:
        match = re.search(r"checklist,\s*(.+)$", question, re.I)
        if match:
            return compact_question(match.group(1))
    if lowered.startswith("during the ") and "checklist" in lowered[:50]:
        match = re.search(r"checklist,\s*(.+)$", question, re.I)
        if match:
            return compact_question(match.group(1))
    return question


def templates_for(category: str, target_type: str, anchor: dict) -> list[str]:
    kind = classify_anchor(anchor)
    kind_key = (category, target_type, kind)
    if kind_key in KIND_TEMPLATES:
        return KIND_TEMPLATES[kind_key]

    base = QUESTION_TEMPLATES.get((category, target_type), [])
    if category == "Chair Flying - Radio Timing & Calls" and kind != "radio":
        generic_radio = re.compile(r"\b(call or action|verbalize for|standard call|transmit or execute)\b", re.I)
        filtered = [template for template in base if not generic_radio.search(template)]
        if filtered:
            base = filtered
    if kind in {"speed", "numeric"}:
        incompatible = INCOMPATIBLE_TEMPLATE_RES.get((category, target_type))
        if incompatible:
            filtered = [template for template in base if not incompatible.search(template)]
            if filtered:
                return filtered
    if kind == "checklist" and target_type == "checklist":
        return base
    if kind in {"procedure", "scenario", "mental", "reference", "other", "radio"}:
        return base
    return base


def category_pool(category_name: str, target_type: str, type_pool: list[dict], anchors: list[dict]) -> list[dict]:
    if category_name == "Chair Flying - Radio Timing & Calls":
        return anchors
    pool = type_pool if type_pool else anchors
    return pool


def choose_distractors(anchor: dict, pool: list[dict], global_values: list[str], seed: str) -> list[str]:
    answer_norm = normalize(str(anchor["value"]))
    kind = classify_value_kind(str(anchor["value"]))
    kind_pool = [
        str(item["value"]).strip()
        for item in pool
        if classify_value_kind(str(item["value"])) == kind and normalize(str(item["value"])) != answer_norm
    ]
    if len(kind_pool) < 3:
        kind_pool.extend(
            str(item).strip()
            for item in global_values
            if classify_value_kind(str(item)) == kind and normalize(str(item)) != answer_norm
        )
    kind_pool = list(dict.fromkeys(kind_pool))
    combined_pool = kind_pool or [
        str(item["value"]).strip() for item in pool if normalize(str(item["value"])) != answer_norm
    ]
    combined_pool = combined_pool or [item for item in global_values if normalize(str(item)) != answer_norm]

    chosen = pick_same_kind_distractors(
        str(anchor["value"]),
        combined_pool,
        seed,
        count=3,
        existing=list(anchor.get("distractors", [])),
    )
    if len(chosen) >= 3:
        return chosen[:3]

    if kind in STRUCTURED_VALUE_KINDS:
        raise RuntimeError(f"Unable to build three {kind} distractors")

    # Last resort for procedure/text answers: any distinct compatible values.
    fallback: list[str] = list(chosen)
    seen = {normalize(str(anchor["value"]))} | {normalize(item) for item in fallback}
    for raw in combined_pool + global_values:
        cleaned = re.sub(r"\s+", " ", str(raw).strip())
        key = normalize(cleaned)
        if not key or key in seen:
            continue
        fallback.append(cleaned)
        seen.add(key)
        if len(fallback) >= 3:
            break
    if len(fallback) < 3:
        raise RuntimeError("Unable to build three distractors")
    return fallback[:3]


def build_entry(
    category_conf: dict,
    target_type: str,
    anchor: dict,
    seq: int,
    pool: list[dict],
    global_values: list[str],
    variant: int = 0,
) -> dict | None:
    pool_len = max(len(pool), 1)
    pass_num = seq // pool_len
    level = (seq % 3) + 1
    loop = pass_num + 1
    templates = templates_for(category_conf["category"], target_type, anchor)
    if not templates:
        return None

    seed_base = f"{category_conf['category']}|{target_type}|{anchor['id']}|{seq}|{variant}"
    start = (pass_num + variant) % len(templates)

    for offset in range(len(templates)):
        template = templates[(start + offset) % len(templates)]
        question = compact_question(
            template.format(
                anchor_context=anchor_context(anchor),
                anchor_label=effective_label(anchor),
                anchor_question=anchor_question_for_template(anchor),
                source=anchor["source"],
            )
        )
        label = f"{category_conf['label_prefix']} L{level} loop {loop} - {effective_label(anchor)}"
        seed = f"{seed_base}|{offset}"
        try:
            distractors = choose_distractors(anchor, pool, global_values, seed)
        except RuntimeError:
            continue
        candidate = {
            "id": "",
            "category": category_conf["category"],
            "type": target_type,
            "label": label,
            "value": anchor["value"],
            "note": f"{category_conf['note']} {LEVEL_NOTES[level]}",
            "source": anchor["source"],
            "question": question,
            "distractors": distractors,
        }
        if check_semantic_match(candidate):
            continue
        if check_entry_audit(candidate):
            continue
        return candidate
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="data/dv20-knowledge.json", help="Input JSON path")
    parser.add_argument("--output", default="data/dv20-knowledge.json", help="Output JSON path")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Remove existing generated category entries before merging",
    )
    parser.add_argument("--write", action="store_true", help="Write merged data to --output")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    with input_path.open("r", encoding="utf-8") as handle:
        existing = json.load(handle)

    if not isinstance(existing, list) or not existing:
        raise RuntimeError("Expected non-empty list of entries")

    target_categories = {entry["category"] for entry in CATEGORY_MATRIX}
    if args.replace:
        existing = [item for item in existing if item.get("category") not in target_categories]

    anchors = [
        item
        for item in existing
        if set(item.keys()) == SCHEMA_KEYS
        and str(item.get("source", "")).strip()
        and item.get("category") not in EXCLUDED_ANCHOR_CATEGORIES
    ]
    if not anchors:
        raise RuntimeError("No valid anchors found")

    anchors.sort(key=lambda item: int(item["id"].split("-")[1]))
    anchors_by_type: dict[str, list[dict]] = {}
    for anchor in anchors:
        anchors_by_type.setdefault(anchor["type"], []).append(anchor)

    global_values = list(dict.fromkeys(str(item["value"]).strip() for item in anchors if str(item["value"]).strip()))
    question_set = {f"{item.get('category', '')}|{normalize(item['question'])}" for item in existing}

    max_id = max(int(item["id"].split("-")[1]) for item in existing)
    generated: list[dict] = []
    counts_by_category: dict[str, int] = {}
    counts_by_type: dict[str, int] = {}

    for category_conf in CATEGORY_MATRIX:
        category_name = category_conf["category"]
        counts_by_category[category_name] = 0
        for target_type, target_count in category_conf["type_targets"].items():
            type_pool = anchors_by_type.get(target_type) or []
            pool = category_pool(category_name, target_type, type_pool, anchors)
            offset = stable_index(f"{category_name}|{target_type}", len(pool))
            made = 0
            cursor = 0
            attempt_limit = target_count * 80

            while made < target_count and cursor < attempt_limit:
                anchor = pool[(offset + cursor) % len(pool)]
                candidate = None
                for variant in range(max(len(templates_for(category_name, target_type, anchor)) * 2, 4)):
                    candidate = build_entry(
                        category_conf, target_type, anchor, cursor, pool, global_values, variant=variant
                    )
                    if candidate is None:
                        continue
                    question_key = f"{category_name}|{normalize(candidate['question'])}"
                    if question_key in question_set:
                        candidate = None
                        continue
                    break
                cursor += 1
                if candidate is None:
                    continue
                if not is_complete_entry(candidate):
                    continue
                question_key = f"{category_name}|{normalize(candidate['question'])}"
                if question_key in question_set:
                    continue
                question_set.add(question_key)
                generated.append(candidate)
                counts_by_category[category_name] += 1
                counts_by_type[target_type] = counts_by_type.get(target_type, 0) + 1
                made += 1

            if made != target_count:
                raise RuntimeError(
                    f"Could not reach target count for {category_name} / {target_type}: "
                    f"made {made} of {target_count}"
                )

    next_id = max_id + 1
    for item in generated:
        item["id"] = f"DV20-{next_id:03d}"
        next_id += 1

    merged = existing + generated

    if args.write:
        with output_path.open("w", encoding="utf-8") as handle:
            json.dump(merged, handle, indent=2, ensure_ascii=False)
            handle.write("\n")

    print(f"existing_entries={len(existing)}")
    print(f"generated_entries={len(generated)}")
    print(f"merged_entries={len(merged)}")
    print("category_counts=" + json.dumps(counts_by_category, sort_keys=True))
    print("type_counts=" + json.dumps(counts_by_type, sort_keys=True))
    print(f"next_available_id=DV20-{next_id:03d}")


if __name__ == "__main__":
    main()
