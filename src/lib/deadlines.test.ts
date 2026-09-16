import { describe, expect, it } from "vitest";
import {
  addOffset,
  computeDeadline,
  describeOffset,
  formatDisplayDate,
  isValidIsoDate,
  parseIsoDate,
  todayIsoDate,
  type DeadlineSpec,
} from "@/lib/deadlines";

function spec(overrides: Partial<DeadlineSpec> = {}): DeadlineSpec {
  return {
    quotedText: "six (6) months from the commencement date",
    amount: 6,
    unit: "months",
    direction: "after",
    basis: "anchor",
    quoteVerified: true,
    ...overrides,
  };
}

describe("parseIsoDate / isValidIsoDate", () => {
  it("accepts a well-formed date", () => {
    expect(parseIsoDate("2026-04-01")).toEqual({ year: 2026, month: 4, day: 1 });
    expect(isValidIsoDate("2026-04-01")).toBe(true);
  });

  it("rejects the wrong shape", () => {
    for (const value of ["", "2026-4-1", "01-04-2026", "2026/04/01", "2026-04", "not a date", "20260401"]) {
      expect(isValidIsoDate(value), value).toBe(false);
    }
  });

  it("rejects dates that do not exist rather than rolling them over", () => {
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-00-10")).toBe(false);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2026-04-00")).toBe(false);
  });

  it("knows about leap years", () => {
    expect(isValidIsoDate("2028-02-29")).toBe(true); // leap
    expect(isValidIsoDate("2026-02-29")).toBe(false); // not leap
    expect(isValidIsoDate("2000-02-29")).toBe(true); // century leap
    expect(isValidIsoDate("1900-02-29")).toBe(false); // century non-leap
  });
});

describe("formatDisplayDate", () => {
  it("uses the DD-Mon-YYYY house format", () => {
    expect(formatDisplayDate("2026-08-28")).toBe("28-Aug-2026");
    expect(formatDisplayDate("2026-01-05")).toBe("05-Jan-2026");
    expect(formatDisplayDate("2026-12-31")).toBe("31-Dec-2026");
  });

  it("does not depend on the host locale", () => {
    // toLocaleDateString would render 08/28/2026 in en-US and 28/08/2026 in en-GB.
    expect(formatDisplayDate("2026-08-28")).toBe("28-Aug-2026");
  });

  it("passes an unparseable value straight through instead of inventing a date", () => {
    expect(formatDisplayDate("whenever")).toBe("whenever");
  });
});

describe("todayIsoDate", () => {
  it("uses the local calendar day, not UTC", () => {
    // 2026-09-16 23:30 local. toISOString() would roll this to the 17th in IST.
    const lateEvening = new Date(2026, 8, 16, 23, 30, 0);
    expect(todayIsoDate(lateEvening)).toBe("2026-09-16");
  });
});

describe("addOffset — days and weeks", () => {
  it("adds days across a month boundary", () => {
    expect(addOffset("2026-04-28", 5, "days", "after")).toBe("2026-05-03");
  });

  it("subtracts days", () => {
    expect(addOffset("2026-04-03", 5, "days", "before")).toBe("2026-03-29");
  });

  it("treats weeks as seven days", () => {
    expect(addOffset("2026-04-01", 2, "weeks", "after")).toBe("2026-04-15");
  });

  it("crosses a year boundary", () => {
    expect(addOffset("2026-12-30", 5, "days", "after")).toBe("2027-01-04");
  });

  it("handles a leap day", () => {
    expect(addOffset("2028-02-28", 1, "days", "after")).toBe("2028-02-29");
    expect(addOffset("2026-02-28", 1, "days", "after")).toBe("2026-03-01");
  });
});

describe("addOffset — months and years clamp to the end of the month", () => {
  it("clamps 31-Jan + 1 month to 28-Feb", () => {
    // Date.UTC(2026, 1, 31) overflows to 3-Mar, which would be silently wrong.
    expect(addOffset("2026-01-31", 1, "months", "after")).toBe("2026-02-28");
  });

  it("clamps to 29-Feb in a leap year", () => {
    expect(addOffset("2028-01-31", 1, "months", "after")).toBe("2028-02-29");
  });

  it("does not clamp when the target month is long enough", () => {
    expect(addOffset("2026-01-31", 3, "months", "after")).toBe("2026-04-30");
    expect(addOffset("2026-01-15", 1, "months", "after")).toBe("2026-02-15");
  });

  it("adds the contract's canonical example: 11 months from 01-Apr-2026", () => {
    expect(addOffset("2026-04-01", 11, "months", "after")).toBe("2027-03-01");
  });

  it("computes the sample agreement's six-month lock-in end", () => {
    expect(addOffset("2026-04-01", 6, "months", "after")).toBe("2026-10-01");
  });

  it("clamps years too", () => {
    expect(addOffset("2028-02-29", 1, "years", "after")).toBe("2029-02-28");
  });

  it("subtracts months across a year boundary", () => {
    expect(addOffset("2026-02-15", 3, "months", "before")).toBe("2025-11-15");
  });

  it("subtracts years", () => {
    expect(addOffset("2026-06-01", 2, "years", "before")).toBe("2024-06-01");
  });
});

describe("addOffset — refuses nonsense", () => {
  it("rejects a bad anchor date", () => {
    expect(addOffset("2026-02-31", 1, "days", "after")).toBeNull();
    expect(addOffset("", 1, "days", "after")).toBeNull();
  });

  it("rejects a non-integer, zero, negative or absurd amount", () => {
    for (const amount of [0, -1, 1.5, 99999]) {
      expect(addOffset("2026-04-01", amount, "months", "after"), String(amount)).toBeNull();
    }
  });
});

describe("computeDeadline", () => {
  it("computes an anchor-relative deadline", () => {
    expect(computeDeadline("2026-04-01", spec())).toEqual({
      iso: "2026-10-01",
      display: "01-Oct-2026",
    });
  });

  it("computes a notice period as a date before the anchor", () => {
    expect(
      computeDeadline("2027-02-28", spec({ amount: 1, unit: "months", direction: "before" })),
    ).toEqual({ iso: "2027-01-28", display: "28-Jan-2027" });
  });

  it("refuses when the quote could not be verified in the clause", () => {
    // This is the important one: an invented deadline must never become a date.
    expect(computeDeadline("2026-04-01", spec({ quoteVerified: false }))).toBeNull();
  });

  it("refuses when the deadline hangs off a future event rather than the anchor", () => {
    expect(computeDeadline("2026-04-01", spec({ basis: "event" }))).toBeNull();
    expect(computeDeadline("2026-04-01", spec({ basis: "none" }))).toBeNull();
  });

  it("refuses when any part of the offset is missing", () => {
    expect(computeDeadline("2026-04-01", spec({ amount: null }))).toBeNull();
    expect(computeDeadline("2026-04-01", spec({ unit: null }))).toBeNull();
    expect(computeDeadline("2026-04-01", spec({ direction: null }))).toBeNull();
  });

  it("refuses an invalid anchor date", () => {
    expect(computeDeadline("not-a-date", spec())).toBeNull();
  });
});

describe("describeOffset", () => {
  it("describes a plural offset", () => {
    expect(describeOffset(spec())).toBe("6 months after");
  });

  it("singularises an offset of one", () => {
    expect(describeOffset(spec({ amount: 1, unit: "months" }))).toBe("1 month after");
    expect(describeOffset(spec({ amount: 1, unit: "days" }))).toBe("1 day after");
  });

  it("returns null when the offset is incomplete", () => {
    expect(describeOffset(spec({ amount: null }))).toBeNull();
  });
});
