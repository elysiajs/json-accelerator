import type { TSchema, Static } from 'typebox'

import { access, mergeObjectIntersection } from './index'

const kindOf = (schema: any) => schema['~kind']
const isOptionalSchema = (schema: any) => schema['~optional'] === true

type TAnySchema = TSchema & Record<string, any>

// ponytail: experimental byte-output codegen. Strings are the felis codegen's
// weak spot in a server: template literals build JSC ropes whose flatten+UTF-8
// cost lands on Response(). This emits bytes directly into a reusable Buffer
// instead. Covers object/array/string/number/boolean/literal/optional/nullable;
// everything else falls back to JSON.stringify+write (still correct, not fast).

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
		let code = `e(p+${bytes.length});`
		for (const b of bytes) code += `buf[p++]=${b};`
		ctx.parts.push(code)
	} else {
		const i = ctx.chunks.length
		ctx.chunks.push(bytes.toString())
		ctx.parts.push(
			`e(p+${bytes.length});c${i}.copy(buf,p);p+=${bytes.length};`
		)
	}
}

function emit(ctx: Ctx, code: string) {
	flush(ctx)
	ctx.parts.push(code)
}

const WRITE_NULL = `e(p+4);buf[p++]=110;buf[p++]=117;buf[p++]=108;buf[p++]=108;`

function gen(schema: TAnySchema, prop: string, ctx: Ctx) {
	if (!schema) return

	const meta = getMeta(schema)
	const s = meta.schema

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

			emit(ctx, `ws(${prop},${ctx.threshold});`)
			break

		case 'number':
		case 'integer':
			if (s.const !== undefined) {
				ctx.pending += JSON.stringify(s.const)
				break
			}

			emit(ctx, `wn(${prop});`)
			break

		case 'boolean':
		case 'bigint': {
			if (s.const !== undefined) {
				ctx.pending += JSON.stringify(s.const)
				break
			}

			const n = ctx.vars++
			emit(
				ctx,
				`{const j${n}=''+${prop};e(p+j${n}.length);p+=buf.write(j${n},p)}`
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

			let hasOptional = false
			for (const key in merged.properties)
				if (isOptionalSchema(merged.properties[key])) {
					hasOptional = true
					break
				}

			const op = ctx.vars++
			if (hasOptional) emit(ctx, `let op${op}=false;`)

			const comma = `if(op${op}){e(p+1);buf[p++]=44}op${op}=true;`

			let first = true
			for (const key in merged.properties) {
				const child = merged.properties[key]
				const name = access(prop, key)
				const isOptional = isOptionalSchema(child)

				if (!hasOptional) {
					ctx.pending += `${first ? '' : ','}${JSON.stringify(key)}:`
					gen(child, name, ctx)
				} else if (isOptional) {
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

				first = false
			}

			ctx.pending += '}'
			break
		}

		case 'array': {
			const items = s.items

			if (
				items &&
				(items.type === 'number' ||
					items.type === 'integer' ||
					items.type === 'boolean' ||
					items.type === 'bigint')
			) {
				// [1,2,3].toString() === '1,2,3' — ASCII only, length is exact
				const n = ctx.vars++
				emit(
					ctx,
					`{const j${n}=${prop}.toString();` +
						`e(p+j${n}.length+2);` +
						`buf[p++]=91;p+=buf.write(j${n},p);buf[p++]=93}`
				)
				break
			}

			const n = ctx.vars++
			emit(
				ctx,
				`{const a${n}=${prop};e(p+1);buf[p++]=91;` +
					`for(let i${n}=0;i${n}<a${n}.length;i${n}++){` +
					`if(i${n}!==0){e(p+1);buf[p++]=44}`
			)
			gen(items, `a${n}[i${n}]`, ctx)
			emit(ctx, `}e(p+1);buf[p++]=93}`)
			break
		}

		default:
			fallback(prop, ctx)
			break
	}

	if (cond) emit(ctx, `}`)
}

function fallback(prop: string, ctx: Ctx) {
	const n = ctx.vars++
	emit(
		ctx,
		`{const j${n}=JSON.stringify(${prop});` +
			`if(j${n}!==undefined){e(p+j${n}.length*3);p+=buf.write(j${n},p)}}`
	)
}

// Shared runtime helpers, compiled once into every encoder's closure:
// - T: 128-entry table marking chars that need escaping (<0x20, '"', '\')
// - ws: single-pass quote+write for ASCII-safe strings; one JS loop replaces
//   regex test + native Buffer.write call. Bails to JSON.stringify on escapes
//   or non-ASCII.
// - wn: manual itoa for int32, ''+n for the rest.
const RUNTIME =
	`const T=new Uint8Array(128);T.fill(1,0,32);T[34]=1;T[92]=1;\n` +
	// escape second byte: \b \t \n \f \r \" \\ — 0 means \u00xx form
	`const E=new Uint8Array(128);E[8]=98;E[9]=116;E[10]=110;E[12]=102;E[13]=114;E[34]=34;E[92]=92;\n` +
	`const H=Buffer.from('0123456789abcdef');\n` +
	`let buf=Buffer.allocUnsafe(16384)\n` +
	`const e=(n)=>{if(n>buf.length){` +
	`const b=Buffer.allocUnsafe(Math.max(buf.length*2,n+1024));` +
	`buf.copy(b);buf=b}}\n` +
	`const esc=/[\\x00-\\x1f"\\\\]/\n` +
	`const wu=(c)=>{` +
	`buf[p++]=92;buf[p++]=117;` +
	`buf[p++]=H[(c>>12)&15];buf[p++]=H[(c>>8)&15];buf[p++]=H[(c>>4)&15];buf[p++]=H[c&15]}\n` +
	`const ws=(s,t)=>{` +
	`const l=s.length;` +
	`e(p+l*3+2);` +
	`buf[p++]=34;` +
	`if(l>t&&!esc.test(s)){p+=buf.write(s,p);buf[p++]=34;return}` +
	`let i=0;` +
	// 4-wide sprint over clean ASCII; bail to the scalar loop on anything odd
	`for(const l4=l-3;i<l4;i+=4){` +
	`const c0=s.charCodeAt(i),c1=s.charCodeAt(i+1),c2=s.charCodeAt(i+2),c3=s.charCodeAt(i+3);` +
	`if((c0|c1|c2|c3)>127||(T[c0]|T[c1]|T[c2]|T[c3])!==0)break;` +
	`buf[p]=c0;buf[p+1]=c1;buf[p+2]=c2;buf[p+3]=c3;p+=4}` +
	`for(;i<l;i++){` +
	`const c=s.charCodeAt(i);` +
	`if(c<128){` +
	`if(T[c]===0){buf[p++]=c;continue}` +
	`e(p+6+(l-i)*3);` +
	`const x=E[c];` +
	`if(x===0)wu(c);` +
	`else{buf[p++]=92;buf[p++]=x}` +
	`continue}` +
	`if(c<2048){buf[p++]=192|(c>>6);buf[p++]=128|(c&63);continue}` +
	`if(c>=55296&&c<57344){` +
	`const c2=s.charCodeAt(i+1);` +
	`if(c<56320&&c2>=56320&&c2<57344){` +
	`i++;` +
	`const u=65536+((c-55296)<<10)+(c2-56320);` +
	`buf[p++]=240|(u>>18);buf[p++]=128|((u>>12)&63);buf[p++]=128|((u>>6)&63);buf[p++]=128|(u&63)` +
	`}else{e(p+6+(l-i)*3);wu(c)}` +
	`continue}` +
	`buf[p++]=224|(c>>12);buf[p++]=128|((c>>6)&63);buf[p++]=128|(c&63)}` +
	`buf[p++]=34}\n` +
	`const wn=(n)=>{` +
	`if((n|0)===n){` +
	`e(p+11);` +
	`if(n===0){buf[p++]=48;return}` +
	`if(n<0){buf[p++]=45;n=-n}` +
	`const q=p;` +
	`while(n>0){buf[p++]=48+(n%10);n=(n/10)|0}` +
	`for(let l=q,r=p-1;l<r;l++,r--){const t=buf[l];buf[l]=buf[r];buf[r]=t}` +
	`}else{const j=''+n;e(p+j.length);p+=buf.write(j,p)}}\n`

// One shared runtime instance: buffer, tables, and the ws/wn/wu/e helper
// literals live in a single closure. Each encoder is eval'd into that scope so
// every compiled encoder reuses the same helper functions (and their JIT
// state) instead of re-parsing its own copy.
const sharedCompile: (src: string) => any = Function(
	`let p=0\n${RUNTIME}return (src)=>eval(src)`
)()

export const createByteEncoder = <T extends TSchema>(
	schema: T,
	{
		// string length above which a clean string is written with native
		// buf.write (one regex test + one native call) instead of the
		// inline per-char loop.
		stringWriteThreshold = 24
	}: { stringWriteThreshold?: number } = {}
): ((v: Static<T>) => Uint8Array) => {
	const ctx: Ctx = {
		chunks: [],
		parts: [],
		pending: '',
		vars: 0,
		threshold: stringWriteThreshold
	}

	gen(schema, 'v', ctx)
	flush(ctx)

	const src =
		`(function(chunks){` +
		ctx.chunks.map((_, i) => `const c${i}=chunks[${i}];`).join('') +
		`return function(v){p=0\n` +
		ctx.parts.join('\n') +
		`\nreturn buf.subarray(0,p)}})`

	// returned Uint8Array is a view over a shared, reused buffer
	// valid only until the next call to any encoder from this module.
	// Fine for immediate `new Response(bytes)`.
	return sharedCompile(src)(ctx.chunks.map((s) => Buffer.from(s)))
}

export default createByteEncoder
