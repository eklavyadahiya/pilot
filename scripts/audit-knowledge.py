#!/usr/bin/env python3
"""Run a full per-entry quality audit on the DV20 knowledge bank."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

from knowledge_validation import fix_all_quality_issues, run_full_audit, scan_red_flags, validate_entries


def write_jsonl(path: Path, records: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def write_review_tsv(path: Path, records: list[dict]) -> None:
    columns = [
        "id",
        "category",
        "question",
        "value",
        "distractor1",
        "distractor2",
        "distractor3",
        "audit_status",
        "issues",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, delimiter="\t", extrasaction="ignore")
        writer.writeheader()
        for record in records:
            writer.writerow(
                {
                    **record,
                    "issues": " | ".join(record.get("issues", [])),
                }
            )


def print_red_flag_report(red_flags: dict[str, int]) -> None:
    print("\nRed-flag scan (must all be zero):")
    all_zero = True
    for name, count in red_flags.items():
        status = "OK" if count == 0 else "FAIL"
        print(f"  {name}: {count} [{status}]")
        if count != 0:
            all_zero = False
    if all_zero:
        print("  All red-flag counts are zero.")
    else:
        print("  Red-flag patterns remain — run with --fix to repair.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="data/dv20-knowledge.json")
    parser.add_argument(
        "--report-jsonl",
        default="data/knowledge-audit-report.jsonl",
        help="Per-entry audit report (one JSON object per line)",
    )
    parser.add_argument(
        "--summary-json",
        default="data/knowledge-audit-summary.json",
        help="Aggregate audit summary",
    )
    parser.add_argument(
        "--review-tsv",
        default="data/knowledge-review.tsv",
        help="Human-review spreadsheet export",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Apply safe automatic fixes before auditing (writes back to --input)",
    )
    parser.add_argument("--worst", type=int, default=20, help="How many worst examples to print")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    input_path = repo_root / args.input
    report_path = repo_root / args.report_jsonl
    summary_path = repo_root / args.summary_json
    review_path = repo_root / args.review_tsv

    with input_path.open("r", encoding="utf-8") as handle:
        entries = json.load(handle)

    if not isinstance(entries, list):
        raise RuntimeError("Expected a JSON array of entries")

    if args.fix:
        fix_stats = fix_all_quality_issues(entries)
        with input_path.open("w", encoding="utf-8") as handle:
            json.dump(entries, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        print("Applied fixes:")
        for key, value in fix_stats.items():
            print(f"  {key}={value}")

    records, summary = run_full_audit(entries)
    red_flags = scan_red_flags(entries)
    summary["red_flags"] = red_flags

    report_path.parent.mkdir(parents=True, exist_ok=True)
    write_jsonl(report_path, records)
    with summary_path.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    write_review_tsv(review_path, records)

    print(f"total_entries={summary['total']}")
    print(f"passed={summary['passed']}")
    print(f"failed={summary['failed']}")
    print(f"report_jsonl={report_path}")
    print(f"summary_json={summary_path}")
    print(f"review_tsv={review_path}")

    if summary["failure_counts_by_reason"]:
        print("failure_counts_by_reason=" + json.dumps(summary["failure_counts_by_reason"], sort_keys=True))
    if summary["failure_counts_by_category"]:
        print("failure_counts_by_category=" + json.dumps(summary["failure_counts_by_category"], sort_keys=True))

    print_red_flag_report(red_flags)

    if summary["failed"] > 0:
        print(f"\nWorst {min(args.worst, summary['failed'])} failing entries:")
        shown = 0
        for record in records:
            if record["status"] != "FAIL":
                continue
            print(f"- {record['id']} [{record['category']}]")
            for issue in record["issues"][:3]:
                print(f"  {issue}")
            print(f"  question: {record['question'][:160]}")
            shown += 1
            if shown >= args.worst:
                break

    red_flag_total = sum(red_flags.values())
    return 1 if summary["failed"] > 0 or red_flag_total > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
