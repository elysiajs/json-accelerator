import { describe, it } from 'bun:test'
import { isEqual } from './utils'

import { Type as t } from 'typebox'

describe('Record', () => {
	it('handle record', () => {
		const shape = t.Record(t.String(), t.String())

		const value = {
			name: 'saltyaom',
			alias: 'saltyaom'
		}

		isEqual(shape, value)
	})

	it('handle record object', () => {
		const shape = t.Record(
			t.String(),
			t.Object({
				name: t.String(),
				age: t.Number()
			})
		)

		const value = {
			saltyaom: {
				name: 'saltyaom',
				age: 23
			},
			chiffon: {
				name: 'chiffon',
				age: 24
			}
		}

		isEqual(shape, value)
	})

	it('handle nested record', () => {
		const shape = t.Record(t.String(), t.Record(t.String(), t.Number()))

		const value = {
			saltyaom: {
				id: 1,
				age: 23
			},
			chiffon: {
				id: 2,
				age: 24
			}
		}

		isEqual(shape, value)
	})

	it('handle unknown record', () => {
		const shape = t.Object(
			{},
			{
				patternProperties: {
					'^[a-z]+$': t.String()
				}
			}
		)

		const value = {
			name: 'saltyaom',
			alias: 'saltyaom',
			unknown: {
				a: 1,
				b: ['a', { hello: 'world' }]
			}
		}

		isEqual(shape, value)
	})
})
