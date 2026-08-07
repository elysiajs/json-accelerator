import { describe, it, expect } from 'bun:test'
import { Type as t } from 'typebox'
import type { TSchema } from 'typebox'

import { createByteEncoder } from '../src'

const parity = (schema: TSchema, value: unknown) => {
	const encode = createByteEncoder(schema) as (v: unknown) => Uint8Array
	expect(Buffer.from(encode(value)).toString()).toBe(JSON.stringify(value))
}

describe('byte encoder', () => {
	it('encodes primitives', () => {
		parity(t.String(), 'hello')
		parity(t.Number(), 42)
		parity(t.Number(), -12.5)
		parity(t.Number(), 0)
		parity(t.Boolean(), true)
		parity(t.Null(), null)
	})

	it('encodes NaN and Infinity as null like JSON.stringify', () => {
		parity(t.Number(), NaN)
		parity(t.Number(), Infinity)
		parity(t.Number(), -Infinity)
		parity(t.Array(t.Number()), [1, NaN, Infinity, -2.5])
	})

	it('escapes control characters, quotes, backslashes', () => {
		const evil =
			'quote:" backslash:\\ newline:\n tab:\t cr:\r ' +
			'ctrl:\x00\x01\x1f backspace:\b formfeed:\f'
		parity(t.String(), evil)
		parity(t.Object({ a: t.String() }), { a: evil })
	})

	it('escapes in long strings (native write path)', () => {
		parity(t.String(), 'a'.repeat(100) + '"' + 'b'.repeat(100))
		parity(t.String(), 'clean ascii '.repeat(20))
	})

	it('encodes unicode', () => {
		parity(t.String(), 'ไม่พี่คืองี้ こんにちわ！ émoji 🔥🇹🇭')
		parity(t.String(), '🔥'.repeat(50))
		// lone surrogates must escape, not become U+FFFD
		parity(t.String(), '\ud800')
		parity(t.String(), 'x'.repeat(60) + '\ud800' + 'y'.repeat(60))
		parity(t.String(), '\udfff tail')
	})

	it('handles nullable and optional', () => {
		const schema = t.Object({
			a: t.Union([t.String(), t.Null()]),
			b: t.Optional(t.String()),
			c: t.Number()
		})
		parity(schema, { a: null, c: 1 })
		parity(schema, { a: 'x', b: 'y', c: 2 })
	})

	it('handles leading-optional objects', () => {
		const schema = t.Object({
			a: t.Optional(t.String()),
			b: t.Optional(t.Number()),
			c: t.String()
		})
		parity(schema, { c: 'only' })
		parity(schema, { a: 'x', c: 'y' })
		parity(schema, { b: 2, c: 'y' })
	})

	it('handles intersect', () => {
		const schema = t.Intersect([
			t.Object({ a: t.String() }),
			t.Object({ b: t.Number() })
		])
		parity(schema, { a: 'x', b: 1 })
	})

	it('handles arrays', () => {
		parity(t.Array(t.Number()), [])
		parity(t.Array(t.Number()), [1, -2, 3.5, 2147483647, -2147483648])
		parity(t.Array(t.String()), ['a', 'b"c', 'ไทย'])
		parity(t.Array(t.Boolean()), [true, false])
		parity(t.Array(t.Object({ a: t.Number() })), [{ a: 1 }, { a: 2 }])
	})

	it('grows the buffer past 64KB', () => {
		const schema = t.Array(t.Object({ s: t.String(), n: t.Number() }))
		const big = Array.from({ length: 5000 }, (_, i) => ({
			s: `item-${i}-` + 'x'.repeat(20),
			n: i * 1.5
		}))
		parity(schema, big)
		// encoder stays reusable after growth
		parity(schema, big.slice(0, 3))
	})

	it('encodes booleans directly', () => {
		parity(t.Boolean(), true)
		parity(t.Boolean(), false)
		parity(t.Object({ a: t.Boolean(), b: t.Boolean() }), {
			a: true,
			b: false
		})

		const optional = t.Object({ a: t.Optional(t.Boolean()), b: t.Number() })
		parity(optional, { b: 1 })
		parity(optional, { a: false, b: 1 })

		const nullable = t.Union([t.Boolean(), t.Null()])
		parity(nullable, true)
		parity(nullable, null)
	})

	it('falls back for records and unknown types', () => {
		parity(t.Record(t.String(), t.Number()), { a: 1, b: 2 })
		parity(t.Any(), { deep: { nested: [1, 'two', null] } })
	})

	it('encodes non-int32 numbers', () => {
		parity(t.Number(), 1754500000000)
		parity(t.Number(), 2 ** 31)
		parity(t.Number(), -1754500000000)
		parity(t.Number(), 3.141592653589793)
		parity(t.Number(), 1e21)
		parity(t.Number(), 5e-7)
		parity(t.Number(), Number.MAX_SAFE_INTEGER)
		parity(t.Array(t.Number()), [Date.now(), 0.5, -1e21])
		parity(
			t.Array(t.Number()),
			Array.from({ length: 20000 }, (_, i) => i + 0.5)
		)
	})
})
