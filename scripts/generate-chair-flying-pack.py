#!/usr/bin/env python3
"""Deterministically generate and merge a chair-flying expansion pack."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from knowledge_validation import anchor_context, is_complete_entry, normalize


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
        "At {anchor_context}, what is the correct next action?",
        "At this point in {anchor_context}, what should you do next?",
    ],
    ("Chair Flying - Phase Decision Drills", "procedure"): [
        "In {anchor_context}, which procedure step applies here?",
        "For {anchor_context}, what is the required action?",
        "At {anchor_context}, what procedure step matches this cue: {anchor_question}",
    ],
    ("Chair Flying - Phase Decision Drills", "mental"): [
        "From memory at {anchor_context}: {anchor_question}",
        "While chair-flying {anchor_context}, what is the correct response?",
    ],
    ("Chair Flying - If Then Traps", "scenario"): [
        "If you notice a problem at {anchor_context}, what should you do before continuing?",
        "You are behind profile at {anchor_context}. What is the correct recovery?",
        "If workload rises at {anchor_context}, what is the priority action?",
    ],
    ("Chair Flying - If Then Traps", "procedure"): [
        "If this trigger appears at {anchor_context}, what procedure step is required now?",
        "At {anchor_context}, which action avoids the common trap?",
        "If you miss this step at {anchor_context}, what procedure restores the correct state?",
    ],
    ("Chair Flying - If Then Traps", "checklist"): [
        "If this checklist cue is missed at {anchor_context}, what must be done next?",
        "At {anchor_context}, which checklist response restores the correct configuration?",
    ],
    ("Chair Flying - Radio Timing & Calls", "mental"): [
        "What call or action should you verbalize for {anchor_context}?",
        "While chair-flying {anchor_context}, what is the correct spoken response?",
    ],
    ("Chair Flying - Radio Timing & Calls", "scenario"): [
        "At {anchor_context}, what call or action is correct?",
        "When reaching {anchor_context}, what should you transmit or execute?",
    ],
    ("Chair Flying - Radio Timing & Calls", "reference"): [
        "Recall the standard call or action for {anchor_context}.",
        "Which reference-standard response applies at {anchor_context}?",
    ],
    ("Chair Flying - Emergency Pressure Loops", "scenario"): [
        "Under time pressure at {anchor_context}, what is your first stabilizing action?",
        "In a high-workload branch at {anchor_context}, what immediate response is correct?",
        "If workload spikes at {anchor_context}, what is the correct next action?",
    ],
    ("Chair Flying - Emergency Pressure Loops", "procedure"): [
        "For this trigger at {anchor_context}, what procedure step must happen without delay?",
        "At {anchor_context}, what emergency procedure step is required now?",
    ],
    ("Chair Flying - Emergency Pressure Loops", "checklist"): [
        "With this cue at {anchor_context}, which checklist action keeps you in the safe branch?",
        "If this trigger appears under pressure at {anchor_context}, what checklist item is mandatory next?",
    ],
}

LEVEL_NOTES = {
    1: "Level 1 direct recall.",
    2: "Level 2 ambiguous alternatives.",
    3: "Level 3 sequence continuity.",
}

RADIO_VALUE_HINTS = (
    "radio call",
    "transmit",
    " readback",
    "squawk",
    "call sign",
    "report traffic",
    "mandatory call",
    "atc",
    " tower",
    "contact tower",
    "announce",
)


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


def is_radio_anchor(anchor: dict) -> bool:
    haystack = " ".join(
        [
            str(anchor.get("value", "")),
            str(anchor.get("label", "")),
            str(anchor.get("question", "")),
            str(anchor.get("source", "")),
        ]
    ).lower()
    return any(hint in haystack for hint in RADIO_VALUE_HINTS)


def choose_distractors(anchor: dict, pool: list[dict], global_values: list[str], seed: str) -> list[str]:
    answer_norm = normalize(str(anchor["value"]))
    chosen: list[str] = []
    seen: set[str] = set()

    def try_add(raw: str) -> None:
        cleaned = re.sub(r"\s+", " ", str(raw).strip())
        if not cleaned:
            return
        key = normalize(cleaned)
        if not key or key == answer_norm or key in seen:
            return
        chosen.append(cleaned)
        seen.add(key)

    for item in anchor.get("distractors", []):
        try_add(item)

    start_pool = stable_index(seed + "|pool", len(pool))
    for idx in range(len(pool)):
        if len(chosen) >= 3:
            break
        try_add(pool[(start_pool + idx) % len(pool)]["value"])

    start_global = stable_index(seed + "|global", len(global_values))
    for idx in range(len(global_values)):
        if len(chosen) >= 3:
            break
        try_add(global_values[(start_global + idx) % len(global_values)])

    if len(chosen) < 3:
        raise RuntimeError("Unable to build three distractors")

    return chosen[:3]


def build_entry(
    category_conf: dict,
    target_type: str,
    anchor: dict,
    seq: int,
    pool: list[dict],
    global_values: list[str],
) -> dict:
    level = (seq % 3) + 1
    loop = (seq // max(1, len(pool))) + 1
    templates = QUESTION_TEMPLATES[(category_conf["category"], target_type)]
    template = templates[seq % len(templates)]
    question = compact_question(
        template.format(
            anchor_context=anchor_context(anchor),
            anchor_label=anchor["label"],
            anchor_question=compact_question(anchor["question"]),
            source=anchor["source"],
        )
    )
    label = f"{category_conf['label_prefix']} L{level} loop {loop} - {anchor['label']}"
    seed = f"{category_conf['category']}|{target_type}|{anchor['id']}|{seq}"
    distractors = choose_distractors(anchor, pool, global_values, seed)
    return {
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
            pool = type_pool if len(type_pool) >= target_count else anchors
            if category_name == "Chair Flying - Radio Timing & Calls":
                radio_pool = [item for item in pool if is_radio_anchor(item)]
                if len(radio_pool) >= 3:
                    pool = radio_pool
            offset = stable_index(f"{category_name}|{target_type}", len(pool))
            made = 0
            cursor = 0
            attempt_limit = target_count * 40

            while made < target_count and cursor < attempt_limit:
                anchor = pool[(offset + cursor) % len(pool)]
                candidate = build_entry(category_conf, target_type, anchor, cursor, pool, global_values)
                if not is_complete_entry(candidate):
                    cursor += 1
                    continue
                question_key = f"{category_name}|{normalize(candidate['question'])}"
                cursor += 1
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
