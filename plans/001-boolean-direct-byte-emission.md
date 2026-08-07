# Plan 001: Emit boolean fields as direct byte stores instead of `''+x` + native `buf.write`

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
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `c715ae1`, 2026-08-07

## Why this matters

`src/bytes.ts` is a schema-compiled JSON encoder that writes UTF-8 bytes into a
reused Buffer; it currently beats native `JSON.stringify` at HTTP load. Boolean
fields are its worst remaining per-field cost: each one is serialized by
stringifying (`''+v`) and then calling native `Buffer.write`, and the native
call alone costs ~15–19ns flat on Bun/JSC. Measured on this machine (M1 Max,
Bun 1.3.x): the current path is **23.4ns per boolean**, while storing the 4–5
ASCII bytes of `true`/`false` directly is **1.8ns** — a ~21ns saving per
boolean field per encode, with zero allocation.

## Current state

- `src/bytes.ts` — the whole byte encoder: schema-walking codegen (`gen`),
  shared runtime helpers (`ws`, `wn`), and `createByteEncoder` which builds the
  final `Function`. This is the only source file this plan touches.
- Booleans and bigints share one switch case in `gen` (src/bytes.ts:135-150):

```ts
			case 'boolean':
			case 'bigint': {
				if (s.const !== undefined) {
					ctx.pending += JSON.stringify(s.const)
					break
				}

				const n = ctx.vars++
				emit(
					ctx,
					`{const j${n}=''+${prop};` +
						`if(q+j${n}.length>b.length)q+=j${n}.length;` +
						`else q+=b.write(j${n},q)}`
				)
				break
			}
```

- Boolean **arrays** take a separate path (src/bytes.ts:258-270), shared with
  bigint arrays, via `arr.toString()` + one native write:

```ts
				if (
					items &&
					(items.type === 'boolean' || items.type === 'bigint')
				) {
					const n = ctx.vars++
					emit(
						ctx,
						`{const j${n}=${prop}.toString();` +
							`if(q+j${n}.length+2>b.length)q+=j${n}.length+2;` +
							`else{b[q++]=91;q+=b.write(j${n},q);b[q++]=93}}`
					)
					break
				}
```

- Design invariants of this file you MUST preserve (they are deliberate,
  measured decisions — see the comment at src/bytes.ts:305-312 and the
  `for(;;)` retry loop in `createByteEncoder`):
  - Plain `b[q++]=<byte>` stores need **no capacity check**: out-of-bounds
    typed-array stores are silent no-ops and `q` keeps advancing, so the single
    `q<=b.length` check at the end catches overflow and retries after growing.
    Only native `b.write`/`copy` calls need explicit guards.
  - `q` is always a plain local, never a closure variable.
  - Generated code is a compact single-line style with `${}` interpolation;
    match it exactly (no added whitespace inside emitted strings).
- Code style: tabs, single quotes, no semicolons. ASCII bytes for the emitted
  literals: `true` = 116,114,117,101; `false` = 102,97,108,115,101; `[` = 91,
  `]` = 93, `,` = 44.
- `DEBUG_SRC=1` on any run prints each encoder's generated source
  (src/bytes.ts:490) — use it to inspect codegen output.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests (bytes) | `bun test test/bytes.test.ts` | all pass (11 before this plan, 12+ after) |
| Full test suite | `bun test` | all pass |
| Bench + parity check | `bun benchmarks/medium.ts` | prints mitata table; throws `Invalid bytes result` on any mismatch |
| Inspect codegen | `DEBUG_SRC=1 bun benchmarks/medium.ts \| head -40` | generated encoder source |

Note: `bunx tsc --noEmit` currently fails with a pre-existing
`moduleResolution=node10` deprecation error in `tsconfig.json` unrelated to
this plan — do not try to fix it, and do not use tsc as a gate. `bun test`
transpiles the TypeScript and is the correctness gate.

## Scope

**In scope** (the only files you may modify):
- `src/bytes.ts` — the `case 'boolean': case 'bigint':` block and (Step 3 only)
  the boolean-array branch in `case 'array':`
- `test/bytes.test.ts` — add tests

**Out of scope** (do NOT touch, even though they look related):
- `src/index.ts` — the older string-based accelerator; separate code path kept
  for compat.
- `wn`, `ws`, `flush`, `emit`, the object/string/number cases — Plan 002 owns
  the `wn` fallback; don't drift into it.
- `benchmarks/*` — read/run them, don't edit them.

## Git workflow

- Branch: `advisor/001-boolean-direct-bytes` off `main`
- Commit style (from `git log`): gitmoji conventional, e.g.
  `:tada: feat: direct byte emission for booleans`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Split the boolean case from bigint and emit direct byte stores

In `gen` (src/bytes.ts:135-150), split the shared `case 'boolean': case
'bigint':` into two cases. `bigint` keeps the existing body unchanged
(including the `s.const` check). `boolean` keeps its `s.const` check but
replaces the string+write emission with a local bind and direct stores:

```ts
			case 'boolean': {
				if (s.const !== undefined) {
					ctx.pending += JSON.stringify(s.const)
					break
				}

				const n = ctx.vars++
				emit(
					ctx,
					`{const t${n}=${prop};` +
						`if(t${n}===true){b[q++]=116;b[q++]=114;b[q++]=117;b[q++]=101}` +
						`else if(t${n}===false){b[q++]=102;b[q++]=97;b[q++]=108;b[q++]=115;b[q++]=101}` +
						`else{const j${n}=''+t${n};` +
						`if(q+j${n}.length>b.length)q+=j${n}.length;` +
						`else q+=b.write(j${n},q)}}`
				)
				break
			}
```

Rationale for the shape: bind `${prop}` (which may be a property chain like
`o1.flag`) to a local once; strict `===true`/`===false` so schema-invalid
values fall to the `else` branch and produce byte-for-byte the same output as
today (behavior parity for garbage input, not just valid input). No capacity
check on the byte stores — see the design invariants above.

**Verify**: `bun test test/bytes.test.ts` → all pass.
**Verify**: `DEBUG_SRC=1 bun -e "import{createByteEncoder}from'./src/bytes';createByteEncoder({type:'object',properties:{a:{type:'boolean'}},required:['a']} as any)"` → printed source contains `===true){b[q++]=116` and no `b.write` for the boolean field's happy path.

### Step 2: Add boolean unit tests

In `test/bytes.test.ts`, extend using the existing `parity` helper (defined at
test/bytes.test.ts:7-10 — it asserts byte output equals `JSON.stringify`). Add
one `it('encodes booleans directly', ...)` block covering:

- `parity(t.Boolean(), true)` and `parity(t.Boolean(), false)`
- booleans inside an object: `parity(t.Object({ a: t.Boolean(), b: t.Boolean() }), { a: true, b: false })`
- optional boolean present and absent: `t.Object({ a: t.Optional(t.Boolean()), b: t.Number() })` with `{ b: 1 }` and `{ a: false, b: 1 }`
- nullable boolean: `t.Union([t.Boolean(), t.Null()])` with `true` and `null`

**Verify**: `bun test test/bytes.test.ts` → 12 tests pass, 0 fail.

### Step 3 (bench-gated): Per-element direct stores for boolean arrays

The boolean-array path currently allocates `arr.toString()` and pays one native
write. Try replacing it, **for boolean items only** (bigint arrays keep the
current path), with a per-element loop in the same style as the number-array
loop directly below it (src/bytes.ts:246-255):

```ts
				if (items && items.type === 'boolean') {
					const n = ctx.vars++
					emit(
						ctx,
						`{const a${n}=${prop};b[q++]=91;` +
							`for(let i${n}=0;i${n}<a${n}.length;i${n}++){` +
							`if(i${n}!==0)b[q++]=44;` +
							`if(a${n}[i${n}]===true){b[q++]=116;b[q++]=114;b[q++]=117;b[q++]=101}` +
							`else{b[q++]=102;b[q++]=97;b[q++]=108;b[q++]=115;b[q++]=101}}` +
							`b[q++]=93}`
					)
					break
				}
```

(The `else` writes `false` without a third branch: inside an array,
`JSON.stringify` serializes non-boolean garbage in ways the current
`toString()` path doesn't reproduce faithfully either — array elements are
schema-trusted here, matching the number-array loop's assumption. Note the
number-array path makes exactly this tradeoff already.)

Gate it with a measurement: write a throwaway mitata bench (do not commit it)
comparing old vs new on `[true,false,true,true,false] × 100` — or simply run
`bun benchmarks/array.ts` before/after if it contains a boolean array. Keep the
change only if the new path is faster or equal; otherwise revert Step 3 and
note that in the README status row.

**Verify**: `bun test test/bytes.test.ts` → all pass (the existing
`handles arrays` test covers `t.Array(t.Boolean())` with `[true, false]`).

## Test plan

- New tests in `test/bytes.test.ts` per Step 2, modeled on the existing
  `describe('byte encoder')` blocks and the `parity` helper.
- Regression safety: every benchmark entrypoint self-verifies parity against
  `JSON.stringify` before running (benchmarks/utils.ts:29-32) and throws
  `Invalid bytes result` on mismatch.
- Verification: `bun test` → all pass; `bun benchmarks/medium.ts` → runs
  without throwing.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun test` exits 0; new boolean test block exists and passes
- [ ] `bun benchmarks/medium.ts` runs without `Invalid bytes result`
- [ ] `DEBUG_SRC=1` output for a boolean-field schema shows direct byte stores (`b[q++]=116`) on the happy path
- [ ] `git status` shows no modified files outside `src/bytes.ts`, `test/bytes.test.ts`, `plans/README.md`
- [ ] `plans/README.md` status row updated (including whether Step 3 was kept or reverted)

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts under "Current state" don't match the live code (drift).
- Any parity test fails and the fix isn't an obvious typo in the emitted byte
  values — do not "fix" a mismatch by loosening a test.
- You find yourself wanting to modify `wn`, `ws`, or any other switch case —
  that's Plan 002 territory or out of scope.
- Step 3's bench shows the per-element loop slower and you're tempted to
  optimize further — revert Step 3 and report instead.

## Maintenance notes

- If a `t.Literal(true)`-style const boolean schema is ever special-cased
  further, the `s.const` early-exit at the top of the case already handles it —
  don't duplicate.
- Reviewer should check: the emitted ASCII bytes (116/114/117/101 and
  102/97/108/115/101) against `'true'`/`'false'`, and that the `else` fallback
  branch in Step 1 is byte-identical to the old path.
- Deferred: bigint fields still take `''+n` + native write; if bigint-heavy
  payloads ever matter, apply the Plan 002 loop-copy treatment there.
