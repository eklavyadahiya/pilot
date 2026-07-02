"""Shared completeness validation for DV20 knowledge bank entries."""

from __future__ import annotations

import hashlib
import re
from difflib import SequenceMatcher

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
CONFUSING_QUESTION_LEN = 200
NEAR_DUPLICATE_RATIO = 0.97
MIN_CONTEXT_SLOT_LEN = 8
AUDIT_TRUNCATE_LEN = 120

PAGE_REF_RE = re.compile(r"\s*\(p\.\d+\)", re.I)
NOTE_FRAGMENT_RE = re.compile(r",\s*NOTE\b.*$", re.I)

GENERIC_UNANSWERABLE_RE = re.compile(
    r"^(?:What is the correct next action|What should you do next|"
    r"What is the correct recovery|What is the priority action|"
    r"What is your first stabilizing action|What immediate response is correct)\?$",
    re.I,
)

REDUNDANT_CHAIR_QUESTION_RE = re.compile(
    r"^(?:At this point in|While chair-flying|From memory at|You are chair-flying|"
    r"You are behind profile at|If workload rises at|If you notice a problem at|"
    r"Under time pressure at|In a high-workload branch at|If workload spikes at)\s+"
    r"(.+?)[,\.:]\s+((?:What|When|Where|How|Which|Does|Is|Are|If)\s+.+\?)\s*$",
    re.I,
)

EMBEDDED_QUESTION_RE = re.compile(
    r"(?:,\s*|\:\s*)(What |When |Where |How |Which |Does |Is |Are |If )",
    re.I,
)

QUESTION_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "is",
        "are",
        "was",
        "were",
        "be",
        "to",
        "of",
        "in",
        "on",
        "at",
        "for",
        "and",
        "or",
        "what",
        "when",
        "where",
        "how",
        "which",
        "does",
        "should",
        "you",
        "your",
        "do",
        "this",
        "that",
        "with",
        "from",
        "after",
        "before",
        "during",
    }
)

STRUCTURED_VALUE_KINDS = frozenset(
    {"speed", "altitude", "rpm", "pressure", "time", "mp", "toggle", "squawk", "angle"}
)

SYNTHETIC_DISTRACTOR_POOLS: dict[str, list[str]] = {
    "toggle": ["ON", "OFF", "UP", "DOWN", "T/O", "FULL", "IN", "OUT", "LDG"],
    "time": ["5 seconds", "15 seconds", "30 seconds", "1 minute", "2 minutes", "5 minutes"],
    "rpm": ["1100 RPM", "1500 RPM", "1700 RPM", "2000 RPM", "2400 RPM", "2600 RPM"],
    "altitude": ["500 ft AAL", "700 ft AAL", "1000 ft AAL", "1500 ft AAL", "2000 ft AAL"],
    "speed": ["55 kts", "60 kts", "65 kts", "70 kts", "75 kts", "80 kts", "90 kts", "100 kts"],
    "mp": ['12" MP', '15" MP', '18" MP', '21" MP', '25" MP', 'Full throttle'],
    "pressure": ["1.0 bar", "1.5 bar", "2.0 bar", "2.5 bar", "3.0 bar"],
    "squawk": ["1200", "2000", "7500", "7600", "7700"],
    "angle": ["15°", "20°", "30°", "45°", "60°"],
}

SPEED_QUESTION_RE = re.compile(
    r"\b(?:what\s+(?:is\s+the\s+)?(?:rotation|approach|climb|target|minimum|maximum|stall|threshold|best\s+glide)?\s*speed\b|"
    r"to\s+what\s+(?:airspeed|speed)\b|what\s+(?:airspeed|target\s+speed)\b|what\s+speed\s+(?:is|are|should|do)\b)\b",
    re.I,
)
ALTITUDE_QUESTION_RE = re.compile(
    r"\b(?:what\s+(?:altitude|height)\b|at\s+what\s+(?:altitude|height)\b|to\s+what\s+(?:altitude|height)\b)\b",
    re.I,
)
RPM_QUESTION_RE = re.compile(
    r"\b(?:what\s+rpm\b|to\s+what\s+rpm\b|at\s+what\s+rpm\b)\b",
    re.I,
)
RADIO_INTENT_QUESTION_RE = re.compile(
    r"\b(?:radio call|transmit to atc|what should you transmit|phraseology|readback)\b",
    re.I,
)
CALL_SIGN_PREFIX_RE = re.compile(r"\bcall sign prefix\b", re.I)
VERIFICATION_QUESTION_RE = re.compile(
    r"\b(?:call out|callout|say aloud|verbal(?:ize|ise)?|spoken)\b",
    re.I,
)

TRUNCATED_ENDINGS = (":", ",", "-", "[", "(", "...")

MANGLED_LABEL_RE = re.compile(
    r"^(Speed|Altitude)\s+(is|does)\b|^Does leaving\b|^Altitude is\b|^And at what\b"
    r"|^Speed may the\b|^Altitude should you\b",
    re.I,
)

LABEL_TAIL_FRAGMENT_RE = re.compile(r"^(you do|you should|do you|should you)\.?$", re.I)

BAD_LABEL_GRAMMAR_RE = re.compile(
    r"\b("
    r"specify for|table specify|emphasize$|require$|should you be|may the|does leaving|"
    r"what is the|what should|what does|what are|what speed|what airspeed|"
    r"what method|what must|what flap|what transponder|what climb|what type|what position|"
    r"to what |at what |how should|how much|where do you|where should|"
    r"when is the|which side|which flap|which type|and at what"
    r")\b",
    re.I,
)

LABEL_INTERROGATIVE_STARTERS = (
    "what ",
    "when ",
    "where ",
    "how ",
    "which ",
    "does ",
    "is the ",
    "are the ",
    "if the ",
    "if you ",
    "during the ",
    "on the ",
    "in the ",
    "per the ",
    "besides ",
    "and at what ",
    "on entry ",
    "according to ",
    "staying in ",
    "a rejected ",
    "after rotation",
    "after applying",
    "after a go-around",
    "after an engine",
    "for a normal takeoff",
    "in a flap",
    "in a power-on",
    "in a flaps-up",
    "in a strong",
    "on a soft",
    "on a short",
    "on an engine",
    "on downwind",
    "during taxi",
    "during descent",
    "during stall",
    "during a normal",
    "during a go-around",
)

META_LOOP_RE = re.compile(r"Full sequence loop \d+, step \d+", re.I)

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
    "phraseology",
    "clearance",
)

RADIO_SOURCE_MARKERS = (
    "radio telephony",
    "radio call",
    "atc ",
    "phraseology",
)

RADIO_QUESTION_RE = re.compile(
    r"\b("
    r"call or action|verbalize|transmit|spoken response|"
    r"standard call|reference-standard response|what should you transmit"
    r")\b",
    re.I,
)

VERBAL_CALLOUT_QUESTION_RE = re.compile(
    r"\b(call out|callout|say aloud|verbal callout|spoken callout)\b",
    re.I,
)

PROCEDURE_QUESTION_RE = re.compile(r"\bprocedure step\b", re.I)
CHECKLIST_QUESTION_RE = re.compile(
    r"\b("
    r"checklist cue is missed|checklist response restores|checklist response applies|"
    r"checklist item is mandatory|checklist action keeps|which checklist response"
    r")\b",
    re.I,
)
ACTION_QUESTION_RE = re.compile(
    r"\b(correct next action|correct recovery|priority action|first stabilizing action|immediate response)\b",
    re.I,
)

SPEED_VALUE_RE = re.compile(r"\b\d+\s*kts?\b", re.I)
NUMERIC_VALUE_RE = re.compile(r'\b\d+\s*(ft|feet|agl|msl|rpm|bar|")\b', re.I)
TOGGLE_VALUES = frozenset({"ON", "OFF", "UP", "DOWN", "T/O", "FULL", "IN", "OUT", "LDG"})

PROCEDURE_VALUE_WORDS = (
    "check",
    "verify",
    "ensure",
    "apply",
    "maintain",
    "reduce",
    "increase",
    "flaps",
    "gear",
    "trim",
    "power",
    "pitch",
    "bank",
    "land",
    "takeoff",
    "climb",
    "descend",
    "approach",
    "switch",
    "select",
    "retard",
    "advance",
    "fly",
)


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def is_radio_value(text: str) -> bool:
    hay = str(text or "").lower()
    return any(hint in hay for hint in RADIO_VALUE_HINTS)


def is_speed_value(text: str) -> bool:
    return bool(SPEED_VALUE_RE.search(str(text or "")))


def is_numeric_callout_value(text: str) -> bool:
    cleaned = str(text or "").strip()
    if is_speed_value(cleaned):
        return True
    if NUMERIC_VALUE_RE.search(cleaned):
        return True
    return cleaned.upper() in TOGGLE_VALUES


def looks_like_procedure_value(text: str) -> bool:
    cleaned = str(text or "").strip()
    if not cleaned:
        return False
    if is_speed_value(cleaned) and len(cleaned.split()) <= 3:
        return False
    if len(cleaned) > 80:
        return True
    lowered = cleaned.lower()
    return any(word in lowered for word in PROCEDURE_VALUE_WORDS)


def is_radio_anchor(anchor: dict) -> bool:
    source = str(anchor.get("source", "")).lower()
    if any(marker in source for marker in RADIO_SOURCE_MARKERS):
        return True
    if is_radio_value(str(anchor.get("value", ""))):
        return True
    question = str(anchor.get("question", "")).lower()
    radio_question_markers = (
        "call sign",
        "radio call",
        "transmit",
        "atc",
        "tower",
        "announce",
        "mandatory call",
        "phraseology",
    )
    return any(marker in question for marker in radio_question_markers)


def is_verbal_callout_anchor(anchor: dict) -> bool:
    if is_radio_anchor(anchor):
        return False
    value = str(anchor.get("value", "")).strip()
    if is_numeric_callout_value(value):
        return True
    label = str(anchor.get("label", "")).lower()
    if "callout" in label or "call-out" in label:
        return True
    anchor_type = str(anchor.get("type", "")).strip()
    return anchor_type in {"speed", "power", "limit", "checklist"}


def classify_anchor(anchor: dict) -> str:
    if is_radio_anchor(anchor):
        return "radio"
    value = str(anchor.get("value", "")).strip()
    if is_speed_value(value):
        return "speed"
    if is_numeric_callout_value(value):
        return "numeric"
    anchor_type = str(anchor.get("type", "")).strip()
    if anchor_type == "checklist":
        return "checklist"
    if anchor_type == "procedure":
        return "procedure"
    if anchor_type in {"scenario", "mental", "reference"}:
        return anchor_type
    return "other"


def strip_page_refs(text: str) -> str:
    cleaned = PAGE_REF_RE.sub("", str(text or ""))
    cleaned = NOTE_FRAGMENT_RE.sub("", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip(" ,.")


def classify_value_kind(text: str) -> str:
    """Classify a value or distractor into a semantic answer type."""
    cleaned = str(text or "").strip()
    if not cleaned:
        return "empty"
    if is_radio_value(cleaned):
        return "radio"
    if looks_like_procedure_value(cleaned) and len(cleaned.split()) > 2:
        return "procedure"
    if re.search(r'\d+\s*["\']|\b\d+"\s*mp\b', cleaned, re.I):
        return "mp"
    if is_speed_value(cleaned):
        return "speed"
    if re.search(r"\b\d+\s*(?:ft|feet|aal|agl|msl)\b", cleaned, re.I):
        return "altitude"
    if re.search(r"\b\d+[-–]\d+\s*rpm\b", cleaned, re.I) or re.search(r"\b\d+\s*rpm\b", cleaned, re.I):
        return "rpm"
    if re.search(r"\b\d+\s*bar\b", cleaned, re.I):
        return "pressure"
    if re.search(r"\b\d+\s*(?:sec(?:ond)?s?|min(?:ute)?s?)\b", cleaned, re.I):
        return "time"
    if re.search(r"\bmp\b", cleaned, re.I):
        return "mp"
    if cleaned.upper() in TOGGLE_VALUES or cleaned.upper() == "LDG":
        return "toggle"
    if re.search(r"\b\d{4}\b", cleaned) and len(cleaned) <= 20:
        return "squawk"
    if re.search(r"\b\d+\s*°", cleaned):
        return "angle"
    if len(cleaned) > 35:
        return "procedure"
    return "text"


def distractor_kind_compatible(answer_kind: str, distractor_kind: str) -> bool:
    if answer_kind == distractor_kind:
        return True
    if answer_kind == "procedure":
        return distractor_kind in {"procedure", "text", "radio"}
    if answer_kind == "radio":
        return distractor_kind in {"radio", "procedure", "text"}
    if answer_kind == "text":
        return distractor_kind in {"text", "toggle", "procedure"}
    if answer_kind == "toggle":
        return distractor_kind in {"toggle", "text"}
    if answer_kind == "numeric":
        return distractor_kind in STRUCTURED_VALUE_KINDS
    return False


def is_redundant_chair_flying_question(question: str) -> bool:
    match = REDUNDANT_CHAIR_QUESTION_RE.match(str(question or "").strip())
    if not match:
        return False

    context = strip_page_refs(match.group(1))
    inner = match.group(2).rstrip("?")
    context_key = normalize(context)
    inner_key = normalize(inner)

    if not context_key or not inner_key:
        return False
    if context_key in inner_key or inner_key in context_key:
        return True

    inner_words = {word for word in inner_key.split() if word not in QUESTION_STOPWORDS}
    context_words = {word for word in context_key.split() if word not in QUESTION_STOPWORDS}
    if len(inner_words) >= 4 and inner_words:
        overlap = len(inner_words & context_words) / len(inner_words)
        if overlap >= 0.75:
            return True
    return False


def check_question_value_alignment(entry: dict) -> list[str]:
    """Return issues when question intent does not match the answer type."""
    issues: list[str] = []
    entry_id = str(entry.get("id", "")).strip() or "?"
    question = str(entry.get("question", "")).strip()
    value = str(entry.get("value", "")).strip()
    if not question or not value:
        return issues

    value_kind = classify_value_kind(value)

    if RADIO_INTENT_QUESTION_RE.search(question) and value_kind != "radio":
        if not (value_kind == "speed" and VERIFICATION_QUESTION_RE.search(question)):
            issues.append(f"{entry_id}: question asks for radio but value is {value_kind}")

    if (
        "call sign" in question.lower()
        and not CALL_SIGN_PREFIX_RE.search(question)
        and value_kind not in {"radio", "text"}
    ):
        issues.append(f"{entry_id}: question asks for call sign but value is {value_kind}")

    if (
        RADIO_QUESTION_RE.search(question)
        and not is_radio_value(value)
        and not (value_kind == "speed" and VERIFICATION_QUESTION_RE.search(question))
    ):
        issues.append(f"{entry_id}: question asks for call/transmit but value is {value_kind}")

    if SPEED_QUESTION_RE.search(question) and value_kind not in {"speed", "procedure", "mp"}:
        issues.append(f"{entry_id}: question asks for speed but value is {value_kind}")

    if ALTITUDE_QUESTION_RE.search(question) and value_kind not in {"altitude", "procedure", "text"}:
        issues.append(f"{entry_id}: question asks for altitude but value is {value_kind}")

    if RPM_QUESTION_RE.search(question) and value_kind not in {"rpm", "procedure"}:
        issues.append(f"{entry_id}: question asks for RPM but value is {value_kind}")

    if ACTION_QUESTION_RE.search(question) and value_kind == "speed" and not looks_like_procedure_value(value):
        issues.append(f"{entry_id}: question asks for action but value is speed-only")

    if PROCEDURE_QUESTION_RE.search(question) and value_kind == "speed" and not looks_like_procedure_value(value):
        issues.append(f"{entry_id}: question asks for procedure step but value is speed-only")

    return issues


def check_distractor_plausibility(entry: dict) -> list[str]:
    """Return issues when distractors are not plausible wrong answers for the question."""
    issues: list[str] = []
    entry_id = str(entry.get("id", "")).strip() or "?"
    value = str(entry.get("value", "")).strip()
    distractors = entry.get("distractors")
    if not value or not isinstance(distractors, list):
        return issues

    answer_kind = classify_value_kind(value)
    for distractor in distractors:
        cleaned = str(distractor or "").strip()
        if not cleaned:
            continue
        distractor_kind = classify_value_kind(cleaned)
        if answer_kind in STRUCTURED_VALUE_KINDS and distractor_kind != answer_kind:
            issues.append(
                f"{entry_id}: distractor '{cleaned[:40]}' is {distractor_kind}, expected {answer_kind}"
            )
        elif answer_kind in {"procedure", "radio"} and not distractor_kind_compatible(answer_kind, distractor_kind):
            issues.append(
                f"{entry_id}: distractor '{cleaned[:40]}' is {distractor_kind}, expected {answer_kind}-like"
            )
        elif answer_kind == "toggle" and distractor_kind not in {"toggle", "text"}:
            issues.append(
                f"{entry_id}: distractor '{cleaned[:40]}' is {distractor_kind}, expected toggle-like"
            )
    return issues


def check_question_answerable(entry: dict) -> list[str]:
    """Return issues when the prompt is not self-contained or clearly asks one thing."""
    issues: list[str] = []
    entry_id = str(entry.get("id", "")).strip() or "?"
    question = str(entry.get("question", "")).strip()
    category = str(entry.get("category", "")).strip()
    if not question:
        return issues

    if GENERIC_UNANSWERABLE_RE.match(question):
        issues.append(f"{entry_id}: generic question without enough context")

    if len(question) > CONFUSING_QUESTION_LEN and category in GENERATED_CATEGORIES:
        issues.append(f"{entry_id}: generated question too long and likely confusing ({len(question)} chars)")

    if is_redundant_chair_flying_question(question):
        issues.append(f"{entry_id}: redundant context repeats the question topic")

    if category in GENERATED_CATEGORIES:
        for prefix in (
            "What call or action should you verbalize for ",
            "Recall the standard call or action for ",
            "Which reference-standard response applies at ",
        ):
            if question.startswith(prefix):
                slot = question[len(prefix) :].rstrip("?").strip()
                slot_clean = strip_page_refs(slot)
                if not slot_clean or len(slot_clean) < MIN_CONTEXT_SLOT_LEN or is_mangled_label(slot_clean):
                    issues.append(f"{entry_id}: chair-flying context slot is incomplete or malformed")
                elif slot_clean.lower().startswith(QUESTION_STARTERS):
                    issues.append(f"{entry_id}: chair-flying context slot is incomplete or malformed")

    embedded = EMBEDDED_QUESTION_RE.search(question)
    if embedded and embedded.start() > 40 and category in GENERATED_CATEGORIES:
        prefix = question[: embedded.start()].strip()
        if prefix.endswith(",") and is_redundant_chair_flying_question(question):
            issues.append(f"{entry_id}: awkward embedded question structure")

    if PAGE_REF_RE.search(question) and category in GENERATED_CATEGORIES:
        without_page = strip_page_refs(question)
        if without_page != question and len(without_page) < MIN_QUESTION_LEN + 10:
            issues.append(f"{entry_id}: question relies on page reference instead of context")

    return issues


class NearDuplicateTracker:
    """Track near-duplicate questions within a validation pass."""

    def __init__(self, threshold: float = NEAR_DUPLICATE_RATIO) -> None:
        self.threshold = threshold
        self.buckets: dict[str, list[tuple[str, str]]] = {}

    def check(self, entry_id: str, question: str) -> list[str]:
        key = normalize(question)
        if not key:
            return []
        bucket_key = " ".join(key.split()[:8])
        for other_id, other_key in self.buckets.get(bucket_key, []):
            if other_key == key:
                continue
            ratio = SequenceMatcher(None, key, other_key).ratio()
            if ratio >= self.threshold:
                return [f"{entry_id}: near-duplicate of {other_id} ({ratio:.2f})"]
        self.buckets.setdefault(bucket_key, []).append((entry_id, key))
        return []


def check_entry_audit(entry: dict, near_dupe_tracker: NearDuplicateTracker | None = None) -> list[str]:
    """Per-entry quality audit beyond schema/completeness checks."""
    issues: list[str] = []
    issues.extend(check_question_answerable(entry))
    issues.extend(check_question_value_alignment(entry))
    issues.extend(check_distractor_plausibility(entry))
    if near_dupe_tracker is not None:
        entry_id = str(entry.get("id", "")).strip() or "?"
        question = str(entry.get("question", "")).strip()
        issues.extend(near_dupe_tracker.check(entry_id, question))
    return issues


def audit_entries(entries: list[dict]) -> tuple[list[str], dict[str, int]]:
    """Audit every entry; return issues and counts grouped by reason prefix."""
    issues: list[str] = []
    reason_counts: dict[str, int] = {}
    near_dupe_tracker = NearDuplicateTracker()

    for entry in entries:
        entry_issues = check_entry_audit(entry, near_dupe_tracker)
        for issue in entry_issues:
            issues.append(issue)
            reason = issue.split(":", 1)[-1].strip().split(" ", 1)[0]
            if "near-duplicate" in issue:
                reason = "near-duplicate"
            elif "distractor" in issue:
                reason = "distractor-type"
            elif "radio" in issue or "call/transmit" in issue:
                reason = "value-alignment-radio"
            elif "speed" in issue and "value" in issue:
                reason = "value-alignment-speed"
            elif "redundant" in issue:
                reason = "redundant-context"
            elif "generic" in issue:
                reason = "generic-question"
            elif "page reference" in issue:
                reason = "page-reference"
            reason_counts[reason] = reason_counts.get(reason, 0) + 1

    return issues, reason_counts


def stable_index(seed: str, size: int) -> int:
    if size <= 0:
        return 0
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest, 16) % size


def pick_same_kind_distractors(
    value: str,
    pool: list[str],
    seed: str,
    count: int = 3,
    existing: list[str] | None = None,
) -> list[str]:
    """Pick distractors from pool that match the semantic type of value."""
    answer_kind = classify_value_kind(value)
    answer_norm = normalize(value)
    chosen: list[str] = []
    seen: set[str] = {answer_norm}

    def try_add(raw: str) -> None:
        cleaned = re.sub(r"\s+", " ", str(raw).strip())
        if not cleaned:
            return
        key = normalize(cleaned)
        if not key or key in seen:
            return
        if not distractor_kind_compatible(answer_kind, classify_value_kind(cleaned)):
            return
        if answer_kind in STRUCTURED_VALUE_KINDS and classify_value_kind(cleaned) != answer_kind:
            return
        chosen.append(cleaned)
        seen.add(key)

    for item in existing or []:
        try_add(item)
        if len(chosen) >= count:
            return chosen[:count]

    compatible = [
        item
        for item in pool
        if normalize(item) != answer_norm
        and (
            classify_value_kind(item) == answer_kind
            if answer_kind in STRUCTURED_VALUE_KINDS
            else distractor_kind_compatible(answer_kind, classify_value_kind(item))
        )
    ]
    if not compatible and answer_kind == "toggle":
        compatible = [value for value in SYNTHETIC_DISTRACTOR_POOLS["toggle"] if normalize(value) != answer_norm]
    if not compatible and answer_kind in SYNTHETIC_DISTRACTOR_POOLS:
        compatible = [
            value for value in SYNTHETIC_DISTRACTOR_POOLS[answer_kind] if normalize(value) != answer_norm
        ]
    if not compatible and answer_kind in STRUCTURED_VALUE_KINDS:
        return chosen[:count]

    start = stable_index(seed, max(len(compatible), 1))
    for offset in range(max(len(compatible), 1)):
        if len(chosen) >= count:
            break
        if compatible:
            try_add(compatible[(start + offset) % len(compatible)])

    if len(chosen) < count and answer_kind in SYNTHETIC_DISTRACTOR_POOLS:
        for synthetic in SYNTHETIC_DISTRACTOR_POOLS[answer_kind]:
            if len(chosen) >= count:
                break
            try_add(synthetic)

    return chosen[:count]


def check_semantic_match(entry: dict) -> list[str]:
    """Return semantic template/value mismatch issues for one entry."""
    issues: list[str] = []
    entry_id = str(entry.get("id", "")).strip() or "?"
    question = str(entry.get("question", "")).strip()
    value = str(entry.get("value", "")).strip()
    category = str(entry.get("category", "")).strip()
    entry_type = str(entry.get("type", "")).strip()

    if not question or not value:
        return issues

    if RADIO_QUESTION_RE.search(question) and not is_radio_value(value):
        if not (is_speed_value(value) and VERBAL_CALLOUT_QUESTION_RE.search(question)):
            issues.append(f"{entry_id}: radio template on non-radio value")

    if PROCEDURE_QUESTION_RE.search(question) and is_speed_value(value) and not looks_like_procedure_value(value):
        issues.append(f"{entry_id}: procedure template on speed-only value")

    if CHECKLIST_QUESTION_RE.search(question):
        value_lower = value.lower()
        if entry_type != "checklist" and "checklist" not in value_lower and value.upper() not in TOGGLE_VALUES:
            if category in GENERATED_CATEGORIES:
                issues.append(f"{entry_id}: checklist template on non-checklist value")

    if ACTION_QUESTION_RE.search(question) and is_speed_value(value) and not looks_like_procedure_value(value):
        issues.append(f"{entry_id}: action template on speed-only value")

    return issues


def is_mangled_label(label: str) -> bool:
    cleaned = re.sub(r"\s+", " ", str(label or "").strip())
    return bool(MANGLED_LABEL_RE.match(cleaned))


def is_bad_label(label: str, question: str = "") -> bool:
    """Return True when a label is a question fragment or otherwise unusable as context."""
    cleaned = re.sub(r"\s+", " ", str(label or "").strip())
    if not cleaned:
        return True
    if len(cleaned) < 4:
        return True
    if cleaned.endswith("?"):
        return True
    if cleaned.startswith("If "):
        return True
    if LABEL_TAIL_FRAGMENT_RE.match(cleaned):
        return True
    if is_mangled_label(cleaned):
        return True

    label_key = normalize(cleaned.rstrip("?"))
    question_key = normalize(str(question or "").rstrip("?"))
    if label_key and question_key and label_key == question_key:
        return True

    lowered = cleaned.lower()
    if lowered.startswith(LABEL_INTERROGATIVE_STARTERS):
        return True
    if BAD_LABEL_GRAMMAR_RE.search(cleaned):
        return True
    return False


def check_label_quality(entry: dict) -> list[str]:
    """Return issues when an entry label is a question fragment or otherwise garbage."""
    issues: list[str] = []
    entry_id = str(entry.get("id", "")).strip() or "?"
    label = str(entry.get("label", "")).strip()
    question = str(entry.get("question", "")).strip()
    if not label:
        issues.append(f"{entry_id}: empty label")
        return issues
    if is_bad_label(label, question):
        issues.append(f"{entry_id}: label is a question fragment or unusable context")
    return issues


def check_generated_context_slot(entry: dict) -> list[str]:
    """Return issues when a generated question embeds a garbage context slot."""
    issues: list[str] = []
    entry_id = str(entry.get("id", "")).strip() or "?"
    category = str(entry.get("category", "")).strip()
    question = str(entry.get("question", "")).strip()
    if category not in GENERATED_CATEGORIES or not question:
        return issues

    for prefix in (
        "What call or action should you verbalize for ",
        "Recall the standard call or action for ",
        "Which reference-standard response applies at ",
    ):
        if question.startswith(prefix):
            slot = strip_page_refs(question[len(prefix) :].rstrip("?").strip())
            if not slot or len(slot) < MIN_CONTEXT_SLOT_LEN:
                issues.append(f"{entry_id}: chair-flying context slot is incomplete or malformed")
            elif is_bad_label(slot):
                issues.append(f"{entry_id}: chair-flying context slot is incomplete or malformed")
            elif slot.lower().startswith(QUESTION_STARTERS):
                issues.append(f"{entry_id}: chair-flying context slot is incomplete or malformed")

    if re.search(r'\bfor "(You do|You should|What is|What should|When should)"\?', question, re.I):
        issues.append(f"{entry_id}: chair-flying context slot is incomplete or malformed")
    if " for You do" in question or "verbalize for You" in question:
        issues.append(f"{entry_id}: chair-flying context slot is incomplete or malformed")

    return issues


WHAT_IS_CORRECT_FOR_RE = re.compile(r"what is correct for", re.I)
VERBALIZE_FOR_RE = re.compile(r"verbalize for", re.I)


def check_red_flags(entry: dict) -> list[str]:
    """Explicit scan for known bad question/label patterns (fail closed)."""
    issues: list[str] = []
    entry_id = str(entry.get("id", "")).strip() or "?"
    question = str(entry.get("question", "")).strip()
    label = str(entry.get("label", "")).strip()

    if " for You do" in question:
        issues.append(f"{entry_id}: red-flag: question contains ' for You do'")
    if VERBALIZE_FOR_RE.search(question):
        issues.append(f"{entry_id}: red-flag: question contains 'verbalize for'")
    if WHAT_IS_CORRECT_FOR_RE.search(question):
        issues.append(f"{entry_id}: red-flag: question contains 'what is correct for'")
    if LABEL_TAIL_FRAGMENT_RE.match(label):
        issues.append(f"{entry_id}: red-flag: fragment label '{label}'")

    for prefix in sorted(CHAIR_FLYING_PREFIXES, key=len, reverse=True):
        slot = context_slot_after_prefix(question, prefix)
        if slot is None:
            continue
        slot_clean = strip_page_refs(slot)
        if 0 < len(slot_clean) < MIN_CONTEXT_SLOT_LEN:
            issues.append(
                f"{entry_id}: red-flag: context slot too short "
                f"({len(slot_clean)} chars): '{slot_clean[:40]}'"
            )
            break

    return issues


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


CONTEXT_SLOT_BOUNDARY_RE = re.compile(
    r"(?:\.\s+|,\s+|:\s*)"
    r"(?="
    r"What |When |Where |How |Which |Does |Is |Are |If |"
    r"By what |Up to |After |During |On |In the |In a |Below |Above |"
    r"To what |At what |While |Under |From |Recall |Confirm "
    r")",
    re.I,
)


def context_slot_after_prefix(question: str, prefix: str) -> str | None:
    idx = question.find(prefix)
    if idx < 0:
        return None
    after = question[idx + len(prefix) :]
    boundary = CONTEXT_SLOT_BOUNDARY_RE.search(after)
    if boundary:
        after = after[: boundary.start()]
    else:
        for stop in ("?", "."):
            if stop in after:
                after = after[: after.index(stop)]
    return after.strip()


def matching_context_slot(question: str) -> tuple[str | None, str | None]:
    """Return the longest matching chair-flying prefix and its context slot."""
    best_prefix: str | None = None
    best_slot: str | None = None
    for prefix in sorted(CHAIR_FLYING_PREFIXES, key=len, reverse=True):
        slot = context_slot_after_prefix(question, prefix)
        if slot is None:
            continue
        if best_prefix is None or len(prefix) > len(best_prefix):
            best_prefix = prefix
            best_slot = slot
    return best_prefix, best_slot


def has_bad_context_slot(question: str, category: str) -> bool:
    if category not in GENERATED_CATEGORIES:
        return False

    prefix, slot = matching_context_slot(question)
    if not prefix or slot is None:
        return False
    slot_clean = strip_page_refs(slot)
    if len(slot_clean) < MIN_CONTEXT_SLOT_LEN:
        return True
    if slot_clean.startswith(QUESTION_STARTERS):
        return True
    if is_mangled_label(slot_clean):
        return True
    if is_bad_label(slot_clean):
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

    issues.extend(check_label_quality(entry))
    issues.extend(check_generated_context_slot(entry))

    bracket_match = re.search(r"\[([^\]]+)\]", question)
    if bracket_match and len(bracket_match.group(1)) > 120:
        issues.append(f"{entry_id}: nested bracket content too long")

    if has_bad_context_slot(question, category):
        issues.append(f"{entry_id}: chair-flying context slot is incomplete or malformed")

    if answer_leaks_into_question(question, value):
        issues.append(f"{entry_id}: correct answer appears verbatim in question")

    issues.extend(check_semantic_match(entry))

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

    issues.extend(check_red_flags(entry))

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
    """Full validation: schema + completeness + quality audit (identical to per-entry audit)."""
    _, summary = run_full_audit(entries)
    return summary.get("all_issue_messages", [])


def issue_reason_code(message: str) -> str:
    """Map a validation message to a stable reason code."""
    lowered = message.lower()
    if "red-flag:" in lowered:
        if " for you do" in lowered:
            return "red_flag_for_you_do"
        if "verbalize for" in lowered:
            return "red_flag_verbalize_for"
        if "what is correct for" in lowered:
            return "red_flag_what_is_correct_for"
        if "fragment label" in lowered:
            return "red_flag_fragment_label"
        if "context slot too short" in lowered:
            return "red_flag_short_context_slot"
        return "red_flag"
    if "schema keys" in lowered:
        return "schema_keys"
    if "missing id" in lowered:
        return "missing_id"
    if "duplicate id" in lowered:
        return "duplicate_id"
    if "duplicate question" in lowered:
        return "duplicate_question"
    if "expected exactly 3 distractors" in lowered:
        return "distractor_count"
    if "empty " in lowered:
        return lowered.split("empty ", 1)[-1].split()[0] + "_empty"
    if "question too short" in lowered:
        return "question_too_short"
    if "question too long" in lowered:
        return "question_too_long"
    if "must end with" in lowered:
        return "question_no_question_mark"
    if "truncated" in lowered:
        return "question_truncated"
    if "??" in lowered:
        return "question_double_mark"
    if "unclosed" in lowered:
        return "question_unclosed_brackets"
    if "full-sequence meta" in lowered:
        return "meta_loop_text"
    if "label is a question fragment" in lowered or "empty label" in lowered:
        return "bad_label"
    if "context slot" in lowered:
        return "bad_context_slot"
    if "verbatim in question" in lowered:
        return "answer_leak"
    if "near-duplicate" in lowered:
        return "near_duplicate"
    if "distractor" in lowered:
        return "distractor_quality"
    if "radio template" in lowered or "call/transmit" in lowered:
        return "semantic_radio"
    if "procedure template" in lowered:
        return "semantic_procedure"
    if "checklist template" in lowered:
        return "semantic_checklist"
    if "action template" in lowered:
        return "semantic_action"
    if "asks for radio" in lowered:
        return "alignment_radio"
    if "asks for speed" in lowered:
        return "alignment_speed"
    if "asks for altitude" in lowered:
        return "alignment_altitude"
    if "asks for rpm" in lowered:
        return "alignment_rpm"
    if "asks for action" in lowered:
        return "alignment_action"
    if "generic question" in lowered:
        return "generic_question"
    if "too long and likely confusing" in lowered:
        return "confusing_question"
    if "redundant context" in lowered:
        return "redundant_context"
    if "page reference" in lowered:
        return "page_reference"
    return "other"


def truncate_audit_text(text: str, max_len: int = AUDIT_TRUNCATE_LEN) -> str:
    cleaned = re.sub(r"\s+", " ", str(text or "").strip())
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 1] + "…"


def check_entry_all(
    entry: dict,
    index: int,
    seen_ids: set[str],
    seen_questions: set[str],
    near_dupe_tracker: NearDuplicateTracker,
) -> list[str]:
    """Run every validation/audit check for one entry (single source of truth)."""
    issues: list[str] = []
    issues.extend(validate_schema(entry, index, seen_ids, seen_questions))
    issues.extend(check_entry_completeness(entry))
    issues.extend(check_entry_audit(entry, near_dupe_tracker))
    return issues


def scan_red_flags(entries: list[dict]) -> dict[str, int]:
    """Count known bad patterns across all entries (must all be zero after fixes)."""
    counts: dict[str, int] = {
        "for_you_do": 0,
        "verbalize_for": 0,
        "what_is_correct_for": 0,
        "fragment_label": 0,
        "short_context_slot": 0,
        "duplicate_question": 0,
    }
    seen_questions: set[str] = set()
    for entry in entries:
        question = str(entry.get("question", "")).strip()
        label = str(entry.get("label", "")).strip()
        if " for You do" in question:
            counts["for_you_do"] += 1
        if VERBALIZE_FOR_RE.search(question):
            counts["verbalize_for"] += 1
        if WHAT_IS_CORRECT_FOR_RE.search(question):
            counts["what_is_correct_for"] += 1
        if LABEL_TAIL_FRAGMENT_RE.match(label):
            counts["fragment_label"] += 1
        for prefix in sorted(CHAIR_FLYING_PREFIXES, key=len, reverse=True):
            slot = context_slot_after_prefix(question, prefix)
            if slot is None:
                continue
            slot_clean = strip_page_refs(slot)
            if 0 < len(slot_clean) < MIN_CONTEXT_SLOT_LEN:
                counts["short_context_slot"] += 1
                break
        question_key = normalize(question)
        if question_key:
            if question_key in seen_questions:
                counts["duplicate_question"] += 1
            else:
                seen_questions.add(question_key)
    return counts


def run_full_audit(entries: list[dict]) -> tuple[list[dict], dict]:
    """Audit every entry; return per-entry records and summary statistics."""
    seen_ids: set[str] = set()
    seen_questions: set[str] = set()
    near_dupe_tracker = NearDuplicateTracker()
    records: list[dict] = []
    reason_counts: dict[str, int] = {}
    category_fail_counts: dict[str, int] = {}
    all_issue_messages: list[str] = []

    for index, entry in enumerate(entries):
        entry_id = str(entry.get("id", "")).strip() or f"entry[{index}]"
        category = str(entry.get("category", "")).strip()
        issues = check_entry_all(entry, index, seen_ids, seen_questions, near_dupe_tracker)
        coded_issues = [f"{issue_reason_code(msg)}: {msg.split(':', 1)[-1].strip()}" for msg in issues]
        status = "PASS" if not issues else "FAIL"
        if issues:
            category_fail_counts[category] = category_fail_counts.get(category, 0) + 1
        for msg in issues:
            all_issue_messages.append(msg)
            code = issue_reason_code(msg)
            reason_counts[code] = reason_counts.get(code, 0) + 1

        distractors = entry.get("distractors") if isinstance(entry.get("distractors"), list) else []
        records.append(
            {
                "id": entry_id,
                "category": category,
                "label": truncate_audit_text(str(entry.get("label", ""))),
                "question": truncate_audit_text(str(entry.get("question", ""))),
                "value": truncate_audit_text(str(entry.get("value", ""))),
                "status": status,
                "issues": coded_issues,
                "distractor1": str(distractors[0]) if len(distractors) > 0 else "",
                "distractor2": str(distractors[1]) if len(distractors) > 1 else "",
                "distractor3": str(distractors[2]) if len(distractors) > 2 else "",
            }
        )

    passed = sum(1 for record in records if record["status"] == "PASS")
    failed = len(records) - passed
    summary = {
        "total": len(records),
        "passed": passed,
        "failed": failed,
        "failure_counts_by_reason": dict(sorted(reason_counts.items())),
        "failure_counts_by_category": dict(sorted(category_fail_counts.items())),
        "red_flags": scan_red_flags(entries),
        "all_issue_messages": all_issue_messages,
    }
    return records, summary


def audit_entries(entries: list[dict]) -> tuple[list[str], dict[str, int]]:
    """Audit every entry; return issues and counts grouped by reason code."""
    _, summary = run_full_audit(entries)
    return summary["all_issue_messages"], summary["failure_counts_by_reason"]


def is_complete_entry(entry: dict) -> bool:
    return not check_entry_completeness(entry)


def source_context(source: str) -> str:
    cleaned = str(source or "").strip()
    if " - " in cleaned:
        return cleaned.split(" - ", 1)[-1].strip().rstrip(".")
    return cleaned.rstrip(".")


def anchor_context(anchor: dict) -> str:
    """Derive a short phase/context phrase from an anchor entry."""
    label = strip_page_refs(re.sub(r"\s+", " ", str(anchor.get("label", "")).strip()).rstrip("?"))
    question = re.sub(r"\s+", " ", str(anchor.get("question", "")).strip()).rstrip("?")
    context_from_source = strip_page_refs(source_context(str(anchor.get("source", ""))))

    if is_bad_label(label, question):
        derived = derive_label_from_entry(anchor)
        if derived and not is_bad_label(derived, question):
            return derived
        return context_from_source or strip_page_refs(question) or "this phase"

    if label and question:
        label_key = normalize(label)
        question_core = normalize(
            re.sub(
                r"^(?:what|when|where|how|which|does|is|are)\s+(?:is\s+the\s+|are\s+the\s+)?",
                "",
                question.rstrip("?"),
                flags=re.I,
            )
        )
        if label_key and question_core and (label_key in question_core or question_core in label_key):
            short = context_from_source or "this phase"
            if len(short) >= MIN_CONTEXT_SLOT_LEN:
                return short
            fallback = effective_label(anchor)
            if len(fallback) >= MIN_CONTEXT_SLOT_LEN:
                return fallback
            return label if label and len(label) >= MIN_CONTEXT_SLOT_LEN else fallback

    if label:
        result = label
    else:
        result = context_from_source or strip_page_refs(question) or "this phase"

    if len(result) < MIN_CONTEXT_SLOT_LEN:
        fallback = effective_label(anchor)
        if len(fallback) >= MIN_CONTEXT_SLOT_LEN:
            return fallback
        if context_from_source and label:
            combined = f"{context_from_source} — {label}".strip()
            if len(combined) >= MIN_CONTEXT_SLOT_LEN:
                return combined
    return result


def effective_label(entry: dict) -> str:
    """Return the entry label, or a derived replacement when the stored label is garbage."""
    label = str(entry.get("label", "")).strip()
    question = str(entry.get("question", "")).strip()
    if label and not is_bad_label(label, question):
        return label
    return derive_label_from_entry(entry)


# Safe auto-fixes for known mangled source labels (id -> corrected label).
LABEL_FIXES: dict[str, str] = {
    "DV20-003": "Engine run-up — throttle RPM (brakes held)",
    "DV20-008": "Emergency landing with engine off — approach speed",
    "DV20-009": "Flap system failure (UP only) — approach speed adjustment",
    "DV20-010": "Taxi warm-up — oil temperature RPM",
    "DV20-025": "Power/speed table — cruise (flaps UP)",
    "DV20-026": "Power/speed table — descent (flaps UP)",
    "DV20-027": "Downwind flaps T/O — throttle setting",
    "DV20-031": "Power/speed table — climb speed (flaps T/O)",
    "DV20-032": "Descent — extra rate per inch MP reduction",
    "DV20-033": "Circuit continuation — power and speed at 700 ft AAL",
    "DV20-034": "Transition to climb — full throttle speed",
    "DV20-035": "Level-off from climb — power reduction speed",
    "DV20-036": "Transition to descent — carburetor heat",
    "DV20-037": "Level-off from descent — carburetor heat OFF point",
    "DV20-043": "Scanflow — traffic reporting method",
    "DV20-044": "Clearing turns — target speed",
    "DV20-046": "Slow flight target speed",
    "DV20-047": "Slow flight entry — initial power reduction",
    "DV20-048": "Approach-to-stall — recovery trigger (besides warning/buffet)",
    "DV20-049": "Power-on stall recovery — minimum speed before climb attitude",
    "DV20-052": "Stall recovery — priority action",
    "DV20-053": "Before lowering flaps — required action",
    "DV20-054": "Accelerating from slow flight — flap retraction speed",
    "DV20-055": "Standard circuit altitude (uncontrolled)",
    "DV20-056": "Circuit area vertical extent",
    "DV20-057": "Standard circuit join point and angle",
    "DV20-058": "Circuit departure point",
    "DV20-059": "Downwind HARS check — included speed",
    "DV20-060": "Turning base — threshold wing position",
    "DV20-061": "Base-to-final turn — altitude and position",
    "DV20-062": "Final centerline — established altitude",
    "DV20-063": "Final approach — max flap extension speed",
    "DV20-066": "Normal takeoff — post-rotation acceleration speed",
    "DV20-067": "Normal takeoff (long hard runway) — flap setting",
    "DV20-068": "Normal takeoff (short/soft runway) — flap setting",
    "DV20-070": "Obstacle clearance takeoff — climb speed",
    "DV20-071": "Soft/rough field takeoff — nose-raise speed",
    "DV20-076": "Flaps-up landing — circuit speeds",
    "DV20-077": "Normal landing — throttle idle point",
    "DV20-078": "Soft field landing — technique emphasis",
    "DV20-079": "Short field landing — post-nosewheel action",
    "DV20-080": "Touch and go (paved) — flap setting",
    "DV20-081": "Touch and go (grass) — flap setting",
    "DV20-082": "Strong crosswind — recommended landing type",
    "DV20-084": "Go-around — flap setting after power",
    "DV20-086": "Go-around — flaps UP height/prop setting",
    "DV20-087": "Go-around at Hilversum — runway side restriction",
    "DV20-088": "Rejected takeoff — abort criterion",
    "DV20-090": "Engine failure after takeoff — glide speed",
    "DV20-091": "Insufficient engine power drill — carburetor heat position",
    "DV20-092": "Engine failure in flight (>1500 ft) — fly-to area",
    "DV20-093": "Engine failure in flight (<700 ft) — fly-to area",
    "DV20-094": "Engine failure in flight — transponder code",
    "DV20-095": "Emergency landing engine off — approach speed",
    "DV20-097": "Generator warning light with discharge — action",
    "DV20-098": "Engine fire in flight — checklist airspeed",
    "DV20-100": "Fuel dipstick — lowest notch indication",
    "DV20-102": "Approved lubricant CAUTION — prohibited substitute",
    "DV20-103": "Departure briefing — Hilversum circuit join point",
    "DV20-105": "EHHV glide-in — downwind requirement",
    "DV20-106": "Solo student call sign prefix",
}


def derive_label_from_entry(entry: dict) -> str:
    """Build a descriptive label from source, question, and value when the stored label is bad."""
    entry_id = str(entry.get("id", "")).strip()
    if entry_id in LABEL_FIXES:
        return LABEL_FIXES[entry_id]

    source = strip_page_refs(source_context(str(entry.get("source", ""))))
    question = str(entry.get("question", "")).lower()
    value = str(entry.get("value", "")).strip()
    entry_type = str(entry.get("type", "")).strip()

    suffix = ""
    if "rpm" in question or ("rpm" in value.lower() and not is_speed_value(value)):
        suffix = " — RPM"
    elif is_speed_value(value) or "speed" in question or "airspeed" in question:
        suffix = " — speed"
    elif "flap" in question:
        suffix = " — flap setting"
    elif "altitude" in question or "height" in question or re.search(r"\b\d+\s*ft\b", value, re.I):
        suffix = " — altitude"
    elif "carburetor" in question or "carburettor" in question:
        suffix = " — carburetor heat"
    elif "transponder" in question or "squawk" in question:
        suffix = " — transponder code"
    elif "throttle" in question or "power setting" in question or re.search(r'\d+"\s*mp', value, re.I):
        suffix = " — power setting"
    elif "where" in question:
        suffix = " — routing/position"
    elif any(
        phrase in question
        for phrase in ("what should you do", "what must", "what is done", "what takes priority")
    ):
        suffix = " — action"
    elif "method" in question or "technique" in question:
        suffix = " — technique"
    elif "call sign" in question:
        suffix = " — call sign prefix"
    elif "notch" in question or ("fuel" in question and "dipstick" in question):
        suffix = " — fuel indication"
    elif "circuit" in question and "left" in question:
        suffix = " — circuit join"
    elif "lubricant" in question:
        suffix = " — lubricant restriction"
    elif "glide-in" in question or "glide in" in question:
        suffix = " — glide-in requirement"
    elif entry_type == "checklist":
        suffix = " — checklist item"

    if source:
        return f"{source}{suffix}" if suffix else source
    if value:
        return value[:60]
    return strip_page_refs(str(entry.get("question", "")).rstrip("?"))[:60] or "Unknown topic"


def apply_label_fixes(entries: list[dict]) -> int:
    fixed = 0
    for entry in entries:
        entry_id = str(entry.get("id", "")).strip()
        if entry_id in LABEL_FIXES:
            if entry.get("label") != LABEL_FIXES[entry_id]:
                entry["label"] = LABEL_FIXES[entry_id]
                fixed += 1
    return fixed


def _find_anchor(entry: dict, entries: list[dict]) -> dict | None:
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
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]

    entry_label = str(entry.get("label", "")).strip()
    suffix = entry_label.rsplit(" - ", 1)[-1].strip() if " - " in entry_label else entry_label
    for item in matches:
        item_label = str(item.get("label", "")).strip()
        if item_label == suffix or suffix in item_label or item_label in suffix:
            return item
    for item in matches:
        if normalize(suffix) in normalize(str(item.get("question", ""))):
            return item
    return matches[0]


def template_context(anchor: dict) -> str:
    """Context phrase for chair-flying templates: long enough and distinct from the question."""
    full_source = strip_page_refs(str(anchor.get("source", "")))
    if len(full_source) >= MIN_CONTEXT_SLOT_LEN:
        return full_source
    label = effective_label(anchor)
    if len(label) >= MIN_CONTEXT_SLOT_LEN:
        return label
    category = str(anchor.get("category", "")).strip()
    if category and len(category) >= MIN_CONTEXT_SLOT_LEN:
        return category
    return "this procedure phase"


def fix_bad_labels(entries: list[dict]) -> int:
    """Rewrite garbage labels on base and derived entries."""
    fixed = 0
    apply_label_fixes(entries)

    for entry in entries:
        label = str(entry.get("label", "")).strip()
        question = str(entry.get("question", "")).strip()
        category = str(entry.get("category", "")).strip()

        if " - " in label and category.startswith("Chair Flying"):
            prefix, suffix = label.rsplit(" - ", 1)
            if is_bad_label(suffix, question):
                anchor = _find_anchor(entry, entries)
                replacement = effective_label(anchor) if anchor else derive_label_from_entry(entry)
                new_label = f"{prefix} - {replacement}"
                if new_label != label:
                    entry["label"] = new_label
                    fixed += 1
            continue

        if is_bad_label(label, question):
            replacement = derive_label_from_entry(entry)
            if replacement and replacement != label:
                entry["label"] = replacement
                fixed += 1

    return fixed


GARBAGE_QUOTED_LABEL_RE = re.compile(
    r'^(?P<prefix>.*?[-:]\s*)(?P<lead>what is correct for|verbalize for|call or action for)\s+"(?P<quoted>[^"]+)"\s*\?',
    re.I,
)

HANDS_AND_EYES_CORRECT_FOR_RE = re.compile(
    r'^(?P<prefix>.*?hands-and-eyes flow item\s*-\s*)what is correct for\s+(?:"(?P<quoted>[^"]+)"|(?P<unquoted>.+?))\??$',
    re.I,
)


def _anchor_question_lower(anchor: dict) -> str:
    anchor_q = str(anchor.get("question", "")).rstrip("?").strip()
    if anchor_q and anchor_q[0].isupper():
        return anchor_q[0].lower() + anchor_q[1:]
    return anchor_q


def fix_garbage_questions(entries: list[dict]) -> int:
    """Rewrite questions that embed garbage quoted label fragments."""
    fixed = 0
    for entry in entries:
        question = str(entry.get("question", "")).strip()
        if not question:
            continue

        hands_match = HANDS_AND_EYES_CORRECT_FOR_RE.match(question)
        if hands_match:
            anchor = _find_anchor(entry, entries)
            replacement_text = _anchor_question_lower(anchor) if anchor else derive_label_from_entry(entry)
            new_question = f"{hands_match.group('prefix')}{replacement_text}?"
            if new_question != question:
                entry["question"] = new_question
                fixed += 1
            continue

        match = GARBAGE_QUOTED_LABEL_RE.match(question)
        if match:
            anchor = _find_anchor(entry, entries)
            replacement_text = (
                _anchor_question_lower(anchor) if anchor else derive_label_from_entry(entry)
            )
            new_question = f"{match.group('prefix')}{replacement_text}?"
            if new_question != question:
                entry["question"] = new_question
                fixed += 1
            continue

        awkward = re.match(
            r"^(?P<prefix>.*?[-:]\s*)what is correct for (?P<body>.+\?)$",
            question,
            re.I,
        )
        if awkward:
            anchor = _find_anchor(entry, entries)
            if anchor:
                anchor_q_lower = _anchor_question_lower(anchor)
                body = awkward.group("body").rstrip("?").strip()
                if normalize(body) == normalize(str(anchor.get("question", "")).rstrip("?")):
                    new_question = f"{awkward.group('prefix')}{anchor_q_lower}?"
                    if new_question != question:
                        entry["question"] = new_question
                        fixed += 1
                    continue

        if WHAT_IS_CORRECT_FOR_RE.search(question):
            anchor = _find_anchor(entry, entries)
            if anchor:
                prefix_match = re.match(r"^(?P<prefix>.*?[-:]\s*)what is correct for\s+", question, re.I)
                if prefix_match:
                    new_question = f"{prefix_match.group('prefix')}{_anchor_question_lower(anchor)}?"
                    if new_question != question:
                        entry["question"] = new_question
                        fixed += 1
                        continue

        if " for You do" in question or "verbalize for You" in question:
            anchor = _find_anchor(entry, entries)
            context = anchor_context(anchor) if anchor else derive_label_from_entry(entry)
            new_question = re.sub(
                r"\bfor You do\b",
                f"for {context}",
                question.replace("verbalize for You", f"verbalize for {context}"),
            )
            if new_question != question:
                entry["question"] = new_question
                fixed += 1

    return fixed


def context_slot_from_question(question: str, category: str) -> tuple[str | None, str | None]:
    if category not in GENERATED_CATEGORIES:
        return None, None
    prefix, slot = matching_context_slot(question)
    if prefix and slot is not None:
        return prefix, strip_page_refs(slot)
    return None, None


def fix_short_context_slots(entries: list[dict]) -> int:
    """Replace too-short template context slots in generated chair-flying questions."""
    fixed = 0
    for entry in entries:
        category = str(entry.get("category", "")).strip()
        if category not in GENERATED_CATEGORIES:
            continue
        question = str(entry.get("question", "")).strip()
        prefix, slot = context_slot_from_question(question, category)
        if not prefix or len(slot) >= MIN_CONTEXT_SLOT_LEN:
            continue
        anchor = _find_anchor(entry, entries)
        if not anchor:
            continue
        new_context = template_context(anchor)
        if len(new_context) < MIN_CONTEXT_SLOT_LEN:
            continue
        old_fragment = prefix + slot
        new_fragment = prefix + new_context
        if old_fragment not in question:
            continue
        new_question = question.replace(old_fragment, new_fragment, 1)
        if new_question == question:
            continue
        trial = {**entry, "question": new_question}
        if check_entry_completeness(trial) or check_red_flags(trial):
            continue
        entry["question"] = new_question
        fixed += 1
    return fixed


def fix_redundant_context_questions(entries: list[dict]) -> int:
    """Rewrite generated questions whose context slot repeats the embedded question topic."""
    fixed = 0
    for entry in entries:
        category = str(entry.get("category", "")).strip()
        if category not in GENERATED_CATEGORIES:
            continue
        question = str(entry.get("question", "")).strip()
        if not is_redundant_chair_flying_question(question):
            continue
        prefix, slot = context_slot_from_question(question, category)
        if not prefix:
            continue
        anchor = _find_anchor(entry, entries)
        if not anchor:
            continue
        new_context = template_context(anchor)
        if new_context == slot or len(new_context) < MIN_CONTEXT_SLOT_LEN:
            continue
        old_fragment = prefix + slot
        new_question = question.replace(old_fragment, prefix + new_context, 1)
        if new_question == question:
            continue
        trial = {**entry, "question": new_question}
        if check_entry_completeness(trial) or check_red_flags(trial):
            continue
        if is_redundant_chair_flying_question(new_question):
            continue
        entry["question"] = new_question
        fixed += 1
    return fixed


def fix_phase_action_questions(entries: list[dict]) -> int:
    """Ensure Phase Actions hands-and-eyes questions match their anchor and stay unique."""
    fixed = 0
    seen_questions = {normalize(str(entry.get("question", ""))) for entry in entries}

    for entry in entries:
        if str(entry.get("category", "")).strip() != "Chair Flying - Phase Actions":
            continue
        question = str(entry.get("question", "")).strip()
        prefix_match = re.match(
            r"^(?P<prefix>Chair-fly[^:]+:\s*hands-and-eyes flow item\s*-\s*)",
            question,
            re.I,
        )
        if not prefix_match:
            continue
        anchor = _find_anchor(entry, entries)
        if not anchor:
            continue
        expected = f"{prefix_match.group('prefix')}{_anchor_question_lower(anchor)}?"
        expected_key = normalize(expected)
        if expected_key == normalize(question):
            continue
        if expected_key in seen_questions:
            continue
        trial = {**entry, "question": expected}
        if check_entry_completeness(trial) or check_red_flags(trial):
            continue
        seen_questions.discard(normalize(question))
        entry["question"] = expected
        seen_questions.add(expected_key)
        fixed += 1
    return fixed


def fix_near_duplicate_questions(entries: list[dict]) -> int:
    """Rewrite generated questions that are near-duplicates of another entry."""
    fixed = 0
    tracker = NearDuplicateTracker()
    seen_normalized: set[str] = set()

    for entry in entries:
        entry_id = str(entry.get("id", "")).strip()
        question = str(entry.get("question", "")).strip()
        category = str(entry.get("category", "")).strip()
        question_key = normalize(question)

        near_dupe_issues = tracker.check(entry_id, question)
        if question_key:
            seen_normalized.add(question_key)

        if not near_dupe_issues or category not in GENERATED_CATEGORIES:
            continue

        anchor = _find_anchor(entry, entries)
        if not anchor:
            continue
        ctx = template_context(anchor)
        anchor_q = _anchor_question_lower(anchor)
        alternatives = [
            f"While chair-flying {ctx}, {anchor_q}?",
            f"From memory at {ctx}: {anchor_q}?",
            f"You are behind profile at {ctx}. {anchor_q}?",
        ]
        for candidate in alternatives:
            candidate_key = normalize(candidate)
            if candidate_key == question_key or candidate_key in seen_normalized:
                continue
            trial = {**entry, "question": candidate}
            if check_entry_completeness(trial) or check_red_flags(trial):
                continue
            trial_issues = NearDuplicateTracker().check(entry_id, candidate)
            if trial_issues:
                continue
            entry["question"] = candidate
            seen_normalized.add(candidate_key)
            fixed += 1
            break

    return fixed


def fix_all_quality_issues(entries: list[dict]) -> dict[str, int]:
    """Apply all safe automatic quality fixes."""
    stats = {
        "fixed_labels": fix_bad_labels(entries),
        "fixed_garbage_questions": fix_garbage_questions(entries),
        "fixed_short_context_slots": fix_short_context_slots(entries),
        "fixed_redundant_context": fix_redundant_context_questions(entries),
        "fixed_phase_action_questions": fix_phase_action_questions(entries),
        "fixed_near_duplicates": fix_near_duplicate_questions(entries),
    }
    # Second pass: fixes can unblock further repairs.
    stats["fixed_short_context_slots"] += fix_short_context_slots(entries)
    stats["fixed_garbage_questions"] += fix_garbage_questions(entries)
    stats["fixed_redundant_context"] += fix_redundant_context_questions(entries)
    stats["fixed_phase_action_questions"] += fix_phase_action_questions(entries)
    stats["fixed_near_duplicates"] += fix_near_duplicate_questions(entries)
    return stats
