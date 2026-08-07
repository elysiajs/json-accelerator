import type { TSchema, Static } from 'typebox'

import { access, mergeObjectIntersection } from './text'

const kindOf = (schema: any) => schema['~kind']
const isOptionalSchema = (schema: any) => schema['~optional'] === true

type TAnySchema = TSchema & Record<string, any>

function getMeta(schema: TAnySchema) {
	const kind = kindOf(schema)
	if (!schema.anyOf || (kind !== undefined && kind !== 'Union'))
		return { schema, isNullable: false, isUndefinable: false }

	let isNullable = false
	let isUndefinable = false
	let inner

	for (const type of schema.anyOf) {
		if (type.type === 'null') {
			isNullable = true
			continue
		}

		if (type.type === 'undefined') {
			isUndefinable = true
			continue
		}

		if (inner)
			// multi-type union: let the caller fall back to JSON.stringify
			return { schema, isNullable: false, isUndefinable: false }

		inner = type
	}

	return { schema: inner ?? schema, isNullable, isUndefinable }
}

interface Ctx {
	chunks: string[]
	parts: string[]
	pending: string
	vars: number
	threshold: number
}

function flush(ctx: Ctx) {
	if (!ctx.pending) return

	const bytes = Buffer.from(ctx.pending)
	ctx.pending = ''

	if (bytes.length <= 32) {
		let code = ''
		for (const b of bytes) code += `b[q++]=${b};`
		ctx.parts.push(code)
	} else {
		const i = ctx.chunks.length
		ctx.chunks.push(bytes.toString())
		ctx.parts.push(
			`if(q+${bytes.length}>b.length)q+=${bytes.length};` +
				`else{c${i}.copy(b,q);q+=${bytes.length}}`
		)
	}
}

function emit(ctx: Ctx, code: string) {
	flush(ctx)
	ctx.parts.push(code)
}

const WRITE_NULL = `b[q++]=110;b[q++]=117;b[q++]=108;b[q++]=108;`

function gen(schema: TAnySchema, prop: string, ctx: Ctx) {
	if (!schema) return

	const meta = getMeta(schema)
	let s = meta.schema

	// Intersect: merge into a plain object schema so it doesn't hit the
	// JSON.stringify fallback
	if (s.allOf && !s.type) s = mergeObjectIntersection(s)

	// bind non-trivial paths to a local once instead of re-loading the
	// property chain for every field access
	let close = false
	if (
		s.type === 'object' &&
		s.properties &&
		!s.additionalProperties &&
		/[.[]/.test(prop)
	) {
		const n = ctx.vars++
		emit(ctx, `{const o${n}=${prop};`)
		prop = `o${n}`
		close = true
	}

	const cond =
		meta.isNullable && meta.isUndefinable
			? `${prop}===null||${prop}===undefined`
			: meta.isNullable
				? `${prop}===null`
				: meta.isUndefinable
					? `${prop}===undefined`
					: ''

	if (cond) emit(ctx, `if(${cond}){${WRITE_NULL}}else{`)

	switch (s.type) {
		case 'string':
			if (s.const !== undefined) {
				ctx.pending += JSON.stringify(s.const)
				break
			}

			// quotes live in the surrounding static chunks; ws writes only
			// the escaped payload bytes
			ctx.pending += '"'
			emit(ctx, `q=ws(b,${prop},q,${ctx.threshold});`)
			ctx.pending += '"'
			break

		case 'number':
		case 'integer':
			if (s.const !== undefined) {
				ctx.pending += JSON.stringify(s.const)
				break
			}

			emit(ctx, `q=wn(b,${prop},q);`)
			break

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

		case 'null':
			ctx.pending += 'null'
			break

		case 'object': {
			const merged = mergeObjectIntersection(s)

			if (
				merged.additionalProperties ||
				merged.patternProperties ||
				!merged.properties
			) {
				fallback(prop, ctx)
				break
			}

			ctx.pending += '{'

			const keys = Object.keys(merged.properties)
			// with a required first field, every later field's comma is
			// statically known and folds into the pending chunk. Leading
			// optionals need runtime comma tracking (op flag).
			const certain =
				keys.length === 0 ||
				!isOptionalSchema(merged.properties[keys[0]])

			if (certain) {
				let first = true
				for (const key of keys) {
					const child = merged.properties[key]
					const name = access(prop, key)

					if (!isOptionalSchema(child)) {
						ctx.pending += `${first ? '' : ','}${JSON.stringify(key)}:`
						gen(child, name, ctx)
					} else {
						emit(ctx, `if(${name}!==undefined){`)
						ctx.pending += `,${JSON.stringify(key)}:`
						gen(child, name, ctx)

						if (child.default !== undefined) {
							emit(ctx, `}else{`)
							ctx.pending += `,${JSON.stringify(key)}:${JSON.stringify(child.default)}`
						}

						emit(ctx, `}`)
					}

					first = false
				}

				ctx.pending += '}'
				break
			}

			const op = ctx.vars++
			emit(ctx, `let op${op}=false;`)

			const comma = `if(op${op}){b[q++]=44}op${op}=true;`

			for (const key of keys) {
				const child = merged.properties[key]
				const name = access(prop, key)

				if (isOptionalSchema(child)) {
					emit(ctx, `if(${name}!==undefined){${comma}`)
					ctx.pending += `${JSON.stringify(key)}:`
					gen(child, name, ctx)

					if (child.default !== undefined) {
						emit(ctx, `}else{${comma}`)
						ctx.pending += `${JSON.stringify(key)}:${JSON.stringify(child.default)}`
					}

					emit(ctx, `}`)
				} else {
					emit(ctx, comma)
					ctx.pending += `${JSON.stringify(key)}:`
					gen(child, name, ctx)
				}
			}

			ctx.pending += '}'
			break
		}

		case 'array': {
			const items = s.items

			if (
				items &&
				(items.type === 'number' || items.type === 'integer')
			) {
				// per-element itoa beats arr.toString()+native write ~2x
				const n = ctx.vars++
				emit(
					ctx,
					`{const a${n}=${prop};b[q++]=91;` +
						`for(let i${n}=0;i${n}<a${n}.length;i${n}++){` +
						`if(i${n}!==0)b[q++]=44;` +
						`q=wn(b,a${n}[i${n}],q)}` +
						`b[q++]=93}`
				)
				break
			}

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

			if (items && items.type === 'bigint') {
				const n = ctx.vars++
				emit(
					ctx,
					`{const j${n}=${prop}.toString();` +
						`if(q+j${n}.length+2>b.length)q+=j${n}.length+2;` +
						`else{b[q++]=91;q+=b.write(j${n},q);b[q++]=93}}`
				)
				break
			}

			const n = ctx.vars++
			emit(
				ctx,
				`{const a${n}=${prop};b[q++]=91;` +
					`for(let i${n}=0;i${n}<a${n}.length;i${n}++){` +
					`if(i${n}!==0)b[q++]=44;` +
					`const e${n}=a${n}[i${n}];`
			)
			gen(items, `e${n}`, ctx)
			emit(ctx, `}b[q++]=93}`)
			break
		}

		default:
			fallback(prop, ctx)
			break
	}

	if (cond) emit(ctx, `}`)
	if (close) emit(ctx, `}`)
}

function fallback(prop: string, ctx: Ctx) {
	const n = ctx.vars++
	emit(
		ctx,
		`{const j${n}=JSON.stringify(${prop});` +
			`if(j${n}!==undefined){` +
			`if(q+j${n}.length*3>b.length)q+=j${n}.length*3;` +
			`else q+=b.write(j${n},q)}}`
	)
}

// Shared runtime, defined once as plain module functions and passed into
// every generated encoder, one copy of the helpers (and their JIT state)
// regardless of how many encoders exist:
// - T: 128-entry table marking chars that need escaping (<0x20, '"', '\')
// - ws(b,s,q,t): escape+write string payload (no quotes), returns new q.
//   Long clean strings take one regex test + one native write; short ones a
//   4-wide JS loop.
// - wn(b,n,q): manual itoa for int32, ''+n for the rest.
const T = new Uint8Array(128)
T.fill(1, 0, 32)
T[34] = 1
T[92] = 1

// escape second byte: \b \t \n \f \r \" \\ — 0 means \u00xx form
const E = new Uint8Array(128)
E[8] = 98
E[9] = 116
E[10] = 110
E[12] = 102
E[13] = 114
E[34] = 34
E[92] = 92

const H = Buffer.from('0123456789abcdef')

const esc = /[\x00-\x1f"\\\ud800-\udfff]/

function wu(b: Buffer, c: number, q: number) {
	b[q++] = 92
	b[q++] = 117
	b[q++] = H[(c >> 12) & 15]
	b[q++] = H[(c >> 8) & 15]
	b[q++] = H[(c >> 4) & 15]
	b[q++] = H[c & 15]
	return q
}

function ws(b: Buffer, s: string, q: number, t: number) {
	const l = s.length

	if (l > t) {
		if (q + l * 3 > b.length) return q + l * 3
		if (!esc.test(s)) return q + b.write(s, q)
	}

	let i = 0

	// 4-wide sprint over clean ASCII; bail to the scalar loop on anything odd
	for (const l4 = l - 3; i < l4; i += 4) {
		const c0 = s.charCodeAt(i),
			c1 = s.charCodeAt(i + 1),
			c2 = s.charCodeAt(i + 2),
			c3 = s.charCodeAt(i + 3)

		if ((c0 | c1 | c2 | c3) > 127 || (T[c0] | T[c1] | T[c2] | T[c3]) !== 0)
			break

		b[q] = c0
		b[q + 1] = c1
		b[q + 2] = c2
		b[q + 3] = c3
		q += 4
	}

	for (; i < l; i++) {
		const c = s.charCodeAt(i)

		if (c < 128) {
			if (T[c] === 0) {
				b[q++] = c
				continue
			}

			const x = E[c]
			if (x === 0) q = wu(b, c, q)
			else {
				b[q++] = 92
				b[q++] = x
			}
			continue
		}

		if (c < 2048) {
			b[q++] = 192 | (c >> 6)
			b[q++] = 128 | (c & 63)
			continue
		}

		if (c >= 55296 && c < 57344) {
			const c2 = s.charCodeAt(i + 1)

			if (c < 56320 && c2 >= 56320 && c2 < 57344) {
				i++
				const u = 65536 + ((c - 55296) << 10) + (c2 - 56320)
				b[q++] = 240 | (u >> 18)
				b[q++] = 128 | ((u >> 12) & 63)
				b[q++] = 128 | ((u >> 6) & 63)
				b[q++] = 128 | (u & 63)
			} else q = wu(b, c, q)

			continue
		}

		b[q++] = 224 | (c >> 12)
		b[q++] = 128 | ((c >> 6) & 63)
		b[q++] = 128 | (c & 63)
	}

	return q
}

function wn(b: Buffer, n: number, q: number) {
	if ((n | 0) === n) {
		if (n === 0) {
			b[q++] = 48
			return q
		}

		if (n < 0) {
			b[q++] = 45
			n = -n
		}

		const s = q
		while (n > 0) {
			b[q++] = 48 + (n % 10)
			n = (n / 10) | 0
		}

		for (let l = s, r = q - 1; l < r; l++, r--) {
			const t = b[l]
			b[l] = b[r]
			b[r] = t
		}

		return q
	}

	// JSON.stringify(NaN/Infinity) === 'null'
	if (n !== n || n === Infinity || n === -Infinity) {
		b[q++] = 110
		b[q++] = 117
		b[q++] = 108
		b[q++] = 108
		return q
	}

	const j = '' + n
	for (let i = 0; i < j.length; i++) b[q++] = j.charCodeAt(i)
	return q
}

// single growable output buffer shared by every encoder; generated code
// reads st.buf once per call and reassigns it on growth
const st = { buf: Buffer.allocUnsafe(65536) }

export function createByteEncoder<T extends TSchema>(
	schema: T,
	{
		// string length above which a clean string is written with native
		// buf.write (one regex test + one native call) instead of the
		// inline per-char loop
		stringWriteThreshold: threshold = 40
	}: { stringWriteThreshold?: number } = {}
): (v: Static<T>) => Uint8Array {
	const ctx: Ctx = {
		chunks: [],
		parts: [],
		pending: '',
		vars: 0,
		threshold
	}

	gen(schema, 'v', ctx)
	flush(ctx)

	const src =
		ctx.chunks.map((_, i) => `const c${i}=chunks[${i}];`).join('') +
		`return function(v){` +
		`while(true){` +
		`const b=st.buf;let q=0;\n` +
		ctx.parts.join('\n') +
		`\nif(q<=b.length)return b.subarray(0,q);` +
		`st.buf=Buffer.allocUnsafe((q*3)>>1)}}`

	if (process.env.DEBUG_SRC) console.log(src)

	return Function(
		'ws',
		'wn',
		'st',
		'chunks',
		src
	)(
		ws,
		wn,
		st,
		ctx.chunks.map((s) => Buffer.from(s))
	)
}

export default createByteEncoder
