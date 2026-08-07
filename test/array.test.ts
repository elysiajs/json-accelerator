import { describe, it } from 'bun:test'
import { isEqual } from './utils'

import { Type as t } from 'typebox'

describe('Array', () => {
	it('handle string array at root', () => {
		const shape = t.Array(t.String())

		isEqual(shape, ['a', 'b'])
	})

	it('handle number array at root', () => {
		const shape = t.Array(t.Number())

		isEqual(shape, [1, 2])
	})

	it('handle boolean array at root', () => {
		const shape = t.Array(t.Number())

		isEqual(shape, [true, false])
	})

	it('handle big int array at root', () => {
		const shape = t.Array(t.Number())

		isEqual(shape, [1n, 2n], [1, 2])
	})

	it('handle array union at root', () => {
		const shape = t.Array(t.Union([t.String(), t.Number()]))

		isEqual(shape, ['a', 'b', 1, 2, 'c'])
	})

	it('handle array object', () => {
		const shape = t.Array(
			t.Object({
				a: t.String(),
				b: t.String()
			})
		)

		isEqual(
			shape,
			[
				{
					a: 'a',
					b: 'b'
				},
				{
					a: 'a',
					b: 'b',
					c: 'c'
				}
			],
			[
				{
					a: 'a',
					b: 'b'
				},
				{
					a: 'a',
					b: 'b'
				}
			]
		)
	})

	it('handle array object with optional', () => {
		const shape = t.Array(
			t.Object({
				a: t.String(),
				b: t.Optional(t.String())
			})
		)

		isEqual(
			shape,
			[
				{
					a: 'a'
				},
				{
					a: 'a',
					b: 'b'
				},
				{
					a: 'a',
					b: 'b',
					c: 'c'
				}
			],
			[
				{ a: 'a' },
				{
					a: 'a',
					b: 'b'
				},
				{
					a: 'a',
					b: 'b'
				}
			]
		)
	})
})
