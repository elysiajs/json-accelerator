# Plan 003: Measure, then maybe implement, sprint re-entry after escapes in `ws`

> **Executor instructions**: Follow this plan step by step. This is a
> MEASURE-FIRST plan: Step 1's benchmark decides whether Steps 2+ run at all.
> Run every verification command and confirm the expected result before moving
> on. If anything in the "STOP conditions" section occurs, stop and report —
> do not improvise. When done (including "measured, not worth it"), update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat c715ae1..HEAD -- src/bytes.ts test/bytes.test.ts`
> If `src/bytes.ts` changed since this plan was written (Plans 001/002 landing
> is expected and fine — they touch `gen`/`wn`, not `ws`), compare the
> "Current state" excerpt of `ws` against the live code; on a mismatch in `ws`
> itself, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (hot inner loop; subtle to restructure without regressing the clean-string path)
- **Depends on**: none (execute after 001/002 to avoid merge friction in the same file)
- **Category**: perf
- **Planned at**: commit `c715ae1`, 2026-08-07

## Why this matters

`ws` in `src/bytes.ts` writes escaped string payloads. Its fast path is a
4-wide "sprint" that stores clean ASCII 4 chars at a time (~0.45ns/char), but
the sprint **bails permanently on the first escape-needing or non-ASCII
character**: the entire remainder of the string then goes through the scalar
1-char-at-a-time loop. For a long string whose only escape is near the front —
a leading quote, an early newline in a bio/description field — most of the
string pays scalar cost (~1ns/char) instead of sprint cost. Restructuring so
the sprint re-enters after each handled special character could roughly halve
the cost of sparse-escape long strings. This is workload-dependent (clean
strings above the 40-char threshold already take a single native write and
never reach these loops — src/bytes.ts:345-348), which is why measurement
gates implementation.

## Current state

- `src/bytes.ts` — `ws(b, s, q, t)` at src/bytes.ts:342-414 is a shared runtime
  helper used by every generated encoder for every non-const string field.
- Structure today (abridged; read the full function before starting):

```ts
function ws(b: Buffer, s: string, q: number, t: number) {
	const l = s.length

	if (l > t) {
		if (q + l * 3 > b.length) return q + l * 3
		if (!esc.test(s)) return q + b.write(s, q)
	}

	let i = 0

	// 4-wide sprint over clean ASCII; bail to the scalar loop on anything odd
	for (const l4 = l - 3; i < l4; i += 4) {
		// ... 4× charCodeAt, combined checks ...
		if ((c0 | c1 | c2 | c3) > 127 || (T[c0] | T[c1] | T[c2] | T[c3]) !== 0)
			break
		// ... 4 stores, q += 4
	}

	for (; i < l; i++) {
		// scalar loop: ASCII store, escape via T/E tables, UTF-8 multibyte,
		// surrogate pairs — handles EVERYTHING from index i to the end
	}

	return q
}
```

- Behavior contract (locked in by tests in `test/bytes.test.ts`, notably
  `escapes control characters...`, `escapes in long strings`, `encodes
  unicode`): output must be byte-identical to `JSON.stringify` minus the
  surrounding quotes — including `\uXXXX` escapes for lone surrogates.
- Design invariants: no capacity checks on `b[q++]` stores (OOB stores are
  silent no-ops, `q` arithmetic stays correct, end-of-encode check retries);
  `q` stays a local; `ws` stays ONE shared module function (do not inline
  per-encoder copies — one JIT copy across all encoders is a measured,
  deliberate decision).
- Measured costs on this machine (M1 Max, Bun 1.3.x): sprint ~0.45ns/char,
  native `buf.write` 15–19ns flat, `esc.test` ~5.3ns.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests (bytes) | `bun test test/bytes.test.ts` | all pass |
| Full test suite | `bun test` | all pass |
| Bench + parity | `bun benchmarks/medium.ts` | mitata table, no `Invalid bytes result` |
| Quote-heavy bench | `bun benchmarks/quote.ts` | mitata table (this benchmark exists for escape-path work) |

Note: `bunx tsc --noEmit` has a pre-existing unrelated tsconfig deprecation
error; use `bun test`, not tsc, as the gate.

## Scope

**In scope**:
- `src/bytes.ts` — the `ws` function ONLY
- `test/bytes.test.ts` — add sparse-escape long-string tests
- A throwaway mitata bench file for Step 1 — create it OUTSIDE the repo (e.g.
  `/tmp/ws-bench.ts`) or delete it before committing; it must not land

**Out of scope**:
- `wu`, `wn`, `gen`, `flush`, the `esc` regex, the `T`/`E` tables' contents
- The long-string native-write fast path (src/bytes.ts:345-348) and the
  40-char threshold — measured and settled
- `src/index.ts`, `benchmarks/*`

## Git workflow

- Branch: `advisor/003-ws-sprint-reentry` off `main` (rebase on 001/002 if they landed)
- Commit style: gitmoji conventional, e.g. `:tada: feat: sprint re-entry in ws`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Benchmark the gap (decides everything)

Write a throwaway mitata bench (`/tmp/ws-bench.ts`) importing nothing from the
repo; copy the current `ws` + tables into it as `wsOld`, and a re-entry variant
as `wsNew`. Bench both on:

1. 200-char clean ASCII string with ONE `"` at index 5 (sparse-early escape)
2. 200-char clean ASCII string with ONE `\n` at index 195 (sparse-late)
3. 30-char string with one escape (below threshold, typical short field)
4. 200-char fully clean ASCII (must hit `b.write` fast path — sanity check
   that the restructure didn't touch it)
5. A quote-dense string, e.g. `'"a'.repeat(60)` (worst case for re-entry
   overhead)

The re-entry shape to test — wrap sprint + scalar handling in an outer loop
where the scalar section handles ONE special character (or a small bounded run)
then continues the outer loop back into the sprint:

```ts
	let i = 0
	outer: while (i < l) {
		for (const l4 = l - 3; i < l4; i += 4) {
			/* current 4-wide body; on oddity: break */
		}
		// scalar: handle chars one at a time, but after handling a special
		// char (escape/multibyte), `continue outer` to re-enter the sprint
		// ... (plain-ASCII chars encountered here still store directly —
		// only re-enter after a SPECIAL char, or the tail loop degenerates)
		if (i >= l) break
		/* handle ONE special char at s[i] exactly as the current scalar loop
		   does (T/E tables, wu, multibyte, surrogate pair), advance i,
		   then continue outer */
	}
```

Decision gate: proceed to Step 2 only if `wsNew` is ≥15% faster on case 1
AND within noise (±3%) on cases 3, 4, and 5. Otherwise: revert nothing (no
repo change was made), mark this plan `REJECTED (measured: <numbers>)` in
`plans/README.md`, and stop — that is a successful outcome.

**Verify**: bench output pasted into your final report, with the decision.

### Step 2: Apply the winning shape to `ws`

Port exactly the variant that won Step 1 into `src/bytes.ts`'s `ws`. Do not
"improve" it further beyond what was measured. Keep the `l > t` native-write
fast path at the top byte-identical.

**Verify**: `bun test test/bytes.test.ts` → all pass, especially
`escapes control characters`, `escapes in long strings`, `encodes unicode`
(lone surrogates: `'x'.repeat(60) + '\ud800' + 'y'.repeat(60)` is already in
the suite and is the trickiest re-entry case — the surrogate-pair lookahead
`s.charCodeAt(i + 1)` must still work when the pair straddles a re-entry
boundary).

### Step 3: Add sparse-escape tests

In `test/bytes.test.ts`, add `it('escapes sparse specials in long strings', ...)`:

- `parity(t.String(), '"' + 'a'.repeat(200))` — escape at index 0
- `parity(t.String(), 'a'.repeat(200) + '"')` — escape at the end
- `parity(t.String(), ('ab"cd\ne').repeat(40))` — periodic escapes
- `parity(t.String(), 'a'.repeat(37) + '🔥' + 'b'.repeat(37))` — multibyte
  mid-string just under/over the 4-wide boundary
- `parity(t.String(), 'aaa\ud800bbb\udfffccc'.repeat(10))` — lone surrogates
  at re-entry points

**Verify**: `bun test test/bytes.test.ts` → all pass, count increased by 1.

### Step 4: Whole-encoder regression check

Run `bun benchmarks/medium.ts`, `bun benchmarks/quote.ts`, and
`bun benchmarks/large.ts` before (via `git stash`) and after. The
`JSON Accelerator (bytes)` row must not regress beyond ±3% noise on any of
them.

**Verify**: no `Invalid bytes result`; numbers in your report.

## Test plan

- Step 3's tests, modeled on the existing escape/unicode blocks in
  `test/bytes.test.ts:29-49`.
- Benchmarks self-verify parity before measuring (benchmarks/utils.ts:29-32).
- Verification: `bun test` → all pass.

## Done criteria

ALL must hold (or the plan is marked REJECTED with Step 1's numbers):

- [ ] Step 1 bench results recorded in the final report and the decision gate applied honestly
- [ ] If implemented: `bun test` exits 0 including the new sparse-escape block
- [ ] If implemented: benchmarks show no regression beyond noise (Step 4)
- [ ] No throwaway bench file committed (`git status` clean of it)
- [ ] No modified files outside `src/bytes.ts`, `test/bytes.test.ts`, `plans/README.md`
- [ ] `plans/README.md` status row updated (DONE or REJECTED with numbers)

## STOP conditions

Stop and report back (do not improvise) if:

- The `ws` function in the live code doesn't match the "Current state" excerpt.
- Any unicode/surrogate parity test fails after the restructure — this is the
  known-subtle case; report the failing input rather than patching around it.
- The clean-string case (Step 1 case 4 / Step 4 large bench) regresses —
  do not trade the common case for the sparse-escape case.
- You want to change the threshold, the regex, or split `ws` into multiple
  functions — all out of scope.

## Maintenance notes

- If this lands, the sprint/scalar structure becomes harder to modify; any
  future change to escaping (e.g. ` `/` ` handling, HTML-safe mode)
  must add tests at re-entry boundaries, not just mid-run.
- Reviewer should scrutinize: surrogate-pair lookahead across the re-entry
  boundary, and loop-bound arithmetic (`l4 = l - 3`) being recomputed
  correctly on each outer iteration.
- If REJECTED, record the measured numbers in the README so nobody re-audits
  this — the finding was plausible and is worth one measurement, once.
