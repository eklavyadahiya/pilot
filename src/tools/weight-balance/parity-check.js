import { computeWeightBalance, DEFAULT_INPUTS } from "./engine.js";

const TOLERANCE = {
  weightKg: 0.05,
  armM: 0.0005,
  momentMkg: 0.05,
  fuelKg: 0.05
};

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function compareValue(actual, expected, tolerance) {
  if (expected === null || expected === undefined) {
    return { ok: true };
  }
  const diff = Math.abs(Number(actual) - Number(expected));
  return { ok: diff <= tolerance, diff, actual, expected };
}

export function runParityCase(testCase, aircraftList, typeList, constants) {
  const results = computeWeightBalance(
    { ...DEFAULT_INPUTS, ...testCase.inputs },
    aircraftList,
    typeList,
    constants
  );
  const failures = [];

  for (const check of testCase.expected) {
    const actual = getPath(results, check.path);
    const tol = TOLERANCE[check.kind || "weightKg"] ?? 0.01;
    const comparison = compareValue(actual, check.value, tol);
    if (!comparison.ok) {
      failures.push({
        path: check.path,
        ...comparison
      });
    }
  }

  return { id: testCase.id, ok: failures.length === 0, failures, results };
}

export function runAllParityCases(cases, aircraftList, typeList, constants) {
  return cases.map((testCase) =>
    runParityCase(testCase, aircraftList, typeList, constants)
  );
}

export function formatParityReport(runResults) {
  const lines = [];
  for (const result of runResults) {
    if (result.ok) {
      lines.push(`PASS ${result.id}`);
    } else {
      lines.push(`FAIL ${result.id}`);
      for (const failure of result.failures) {
        lines.push(
          `  ${failure.path}: got ${failure.actual}, expected ${failure.expected}, diff ${failure.diff}`
        );
      }
    }
  }
  return lines.join("\n");
}
