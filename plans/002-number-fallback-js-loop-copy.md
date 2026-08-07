# Plan 002: Replace native `buf.write` with a JS byte loop in `wn`'s non-int32 fallback

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c715ae1..HEAD -- src/bytes.ts test/bytes.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (independent of Plan 001; both touch `src/bytes.ts`, so rebase if executed after it)
- **Category**: perf
- **Planned at**: commit `c715ae1`, 2026-08-07

## Why this matters

In `src/bytes.ts`, every number that is not an int32 — **all doubles** (prices,
ratios, coordinates) and **all integers above 2^31** (millisecond timestamps
like `Date.now()`, large IDs) — falls through the manual itoa in `wn` to a
`''+n` conversion followed by native `Buffer.write`. On Bun/JSC a native call
costs ~15–19ns flat, while a JS loop storing ASCII bytes costs ~0.45ns/char.
Number strings are short (4–17 chars) and pure ASCII, so the native call is
almost all overhead. Measured on this machine (M1 Max, Bun 1.3.x): stringify+
write is **21.1ns** per double vs **10.4ns** for stringify+JS-loop — a ~11ns
saving per non-int32 number per encode. Timestamps being non-int32 makes this
one of the most commonly hit paths in real API payloads.

## Current state

- `src/bytes.ts` — schema-compiled byte encoder. `wn` (src/bytes.ts:416-455) is
  a shared runtime helper passed into every generated encoder; it writes a
  number at position `q` in buffer `b` and returns the new `q`.
- The fallback at the end of `wn` (src/bytes.ts:452-454) is the target:

```ts
	const j = '' + n
	if (q + j.length > b.length) return q + j.length
	return q + b.write(j, q)
```

- Directly above it (src/bytes.ts:443-450) NaN/±Infinity are handled (written
  as `null`), and above that the int32 path does manual itoa. Only the final
  three lines change.
- Design invariants of this file you MUST preserve (deliberate, measured
  decisions — see comments at src/bytes.ts:305-312 and the retry loop in
  `createByteEncoder`, src/bytes.ts:484-488):
  - Plain `b[q++]=<byte>` stores need **no capacity check**: out-of-bounds
    typed-array stores are silent no-ops and `q` keeps advancing correctly, so
    the single `q<=b.length` check at the end of the generated function catches
    overflow and the whole encode retries after growing the buffer. The
    explicit `q + j.length > b.length` guard exists **only because `b.write`
    truncates silently**; once the native call is gone, the guard goes too.
  - `q` stays a plain local (parameter), never a closure variable.
- Why the replacement is safe: `''+n` for a finite JS number produces only
  ASCII characters (`0-9`, `-`, `.`, `e`, `+`), each one UTF-16 code unit ≤
  127, so `charCodeAt(i)` is the exact UTF-8 byte.
- Code style: tabs, single quotes, no semicolons.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests (bytes) | `bun test test/bytes.test.ts` | all pass (11 before this plan, 12+ after) |
| Full test suite | `bun test` | all pass |
| Bench + parity check | `bun benchmarks/medium.ts` | mitata table; throws `Invalid bytes result` on mismatch |
| Number-heavy bench | `bun benchmarks/multiple-queries.ts` | mitata table; bytes encoder should not regress vs the pre-change run |

Note: `bunx tsc --noEmit` currently fails with a pre-existing
`moduleResolution=node10` deprecation error in `tsconfig.json` unrelated to
this plan — do not fix it and do not use tsc as a gate. `bun test` is the gate.

## Scope

**In scope** (the only files you may modify):
- `src/bytes.ts` — ONLY the last three lines of `wn`
- `test/bytes.test.ts` — add tests

**Out of scope** (do NOT touch, even though they look related):
- The int32 itoa path in `wn` — measured and settled (a 2-digit pair-table
  variant was benchmarked at parity, 5.5 vs 5.4ns; don't reintroduce it).
- The `case 'boolean': case 'bigint':` block in `gen` — Plan 001 owns booleans;
  the bigint string path is explicitly deferred.
- `ws`, `wu`, `flush`, `fallback` (the `JSON.stringify` fallback writes long
  multi-hundred-char strings, where native write is correct — leave its guard
  alone).
- `src/index.ts`, `benchmarks/*`.

## Git workflow

- Branch: `advisor/002-wn-fallback-loop` off `main`
- Commit style (from `git log`): gitmoji conventional, e.g.
  `:tada: feat: js-loop copy for non-int32 numbers`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Replace the fallback write

In `wn` (src/bytes.ts:452-454), replace:

```ts
	const j = '' + n
	if (q + j.length > b.length) return q + j.length
	return q + b.write(j, q)
```

with:

```ts
	const j = '' + n
	for (let i = 0; i < j.length; i++) b[q++] = j.charCodeAt(i)
	return q
```

No capacity guard — see the design invariant in "Current state": OOB stores
are no-ops, `q` advances correctly, and the caller's end-of-encode check
triggers the grow-and-retry loop.

**Verify**: `bun test test/bytes.test.ts` → all pass (the existing suite
already covers doubles, negatives, NaN/Infinity, and number arrays).

### Step 2: Add non-int32 tests

In `test/bytes.test.ts`, using the existing `parity` helper
(test/bytes.test.ts:7-10), add one `it('encodes non-int32 numbers', ...)`
covering the fallback path explicitly:

- `parity(t.Number(), 1754500000000)` — timestamp-scale integer (> 2^31)
- `parity(t.Number(), 2 ** 31)` — first integer past the int32 itoa
- `parity(t.Number(), -1754500000000)`
- `parity(t.Number(), 3.141592653589793)` — long double
- `parity(t.Number(), 1e21)` — exponent form (`"1e+21"`, exercises `e`/`+` chars)
- `parity(t.Number(), 5e-7)` — negative exponent form
- `parity(t.Number(), Number.MAX_SAFE_INTEGER)`
- `parity(t.Array(t.Number()), [Date.now(), 0.5, -1e21])` — fallback inside the
  per-element array loop
- Buffer-growth interaction: `parity(t.Array(t.Number()), Array.from({ length: 20000 }, (_, i) => i + 0.5))`
  — thousands of doubles forces the encode past 64KB so the grow-and-retry
  path runs through the new guardless loop

**Verify**: `bun test test/bytes.test.ts` → 12 tests pass, 0 fail.

### Step 3: Confirm no regression on benchmarks

Run `bun benchmarks/medium.ts` and `bun benchmarks/multiple-queries.ts` once
before your change (on a clean checkout via `git stash` / `git stash pop`) and
once after. The `JSON Accelerator (bytes)` row should be equal or faster after
the change. mitata output is noisy at ±3%; a change within noise is fine, a
consistent slowdown beyond that is a STOP condition.

**Verify**: both benchmarks run without throwing `Invalid bytes result`.

## Test plan

- New tests per Step 2 in `test/bytes.test.ts`, modeled on the existing
  `encodes NaN and Infinity` block (test/bytes.test.ts:22-27).
- The benchmark harness self-verifies byte output against `JSON.stringify`
  before measuring (benchmarks/utils.ts:29-32).
- Verification: `bun test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun test` exits 0; the new non-int32 test block exists and passes
- [ ] `grep -n "b.write" src/bytes.ts` shows NO match inside `wn` (matches remain in `gen`'s emitted strings, `ws`, and `fallback` — those are expected)
- [ ] `bun benchmarks/medium.ts` and `bun benchmarks/multiple-queries.ts` run without `Invalid bytes result`
- [ ] `git status` shows no modified files outside `src/bytes.ts`, `test/bytes.test.ts`, `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `wn` excerpt in "Current state" doesn't match the live code (drift —
  e.g. Plan 001 or other work landed changes nearby).
- Any parity test fails — especially the exponent forms (`1e+21`, `5e-7`);
  do not special-case them, report instead.
- Step 3 shows a consistent bytes-encoder slowdown beyond noise on either
  benchmark.
- You're tempted to also change the `fallback` function's or `ws`'s native
  writes — they handle long strings where native write wins; out of scope.

## Maintenance notes

- The guardless loop is only correct while the encoder keeps its
  write-optimistically-check-once design (the `for(;;)` retry in
  `createByteEncoder`). If per-call capacity pre-checks are ever introduced,
  this loop needs revisiting with the rest.
- Reviewer should scrutinize: removal of the capacity guard (correct per the
  OOB-store invariant), and that exponent-form output is byte-identical to
  `JSON.stringify`.
- Deferred: the bigint field path in `gen` (`case 'bigint'`) still uses
  `''+n` + native write; same treatment applies if bigint payloads ever matter
  (noted in Plan 001 as well).
