import { describe, expect, it } from 'bun:test'
import { isEqual, Nullable } from './utils'

import { Type as t } from 'typebox'

import { createAccelerator } from '../src'

describe('Core', () => {
	it('handle string', () => {
		const shape = t.String()

		const value = 'saltyaom'

		isEqual(shape, value)
	})

	it('handle number', () => {
		const shape = t.Number()

		const value = 0

		isEqual(shape, value)
	})

	it('handle boolean', () => {
		const shape = t.Boolean()

		const value = true

		isEqual(shape, value)
	})

	it('handle literal', () => {
		const shape = t.Literal('saltyaom')

		const value = 'saltyaom'

		isEqual(shape, value)
	})

	it('handle null', () => {
		const shape = t.Null()

		const value = null

		isEqual(shape, value)
	})

	it('handle undefined', () => {
		const shape = t.Undefined()

		const value = undefined

		expect(createAccelerator(shape)(value)).toBe('')
	})

	it('handle integer', () => {
		const shape = t.Integer()

		const value = 2.2

		isEqual(shape, value)
	})

	it('handle bigint', () => {
		const shape = t.BigInt()

		const value = BigInt(2)

		isEqual(shape, +(value + ''))
	})

	it('handle object', () => {
		const shape = t.Object({
			name: t.String(),
			id: t.Number()
		})

		const value = {
			id: 0,
			name: 'saltyaom'
		}

		isEqual(shape, value)
	})

	it('handle string array', () => {
		const shape = t.Object({
			name: t.String(),
			games: t.Array(t.String())
		})

		const value = {
			name: 'saltyaom',
			games: ['MiSide', 'Strinova']
		}

		isEqual(shape, value)
	})

	it('handle number array', () => {
		const shape = t.Object({
			name: t.String(),
			games: t.Array(t.Number())
		})

		const value = {
			name: 'saltyaom',
			games: [1, 2, 3]
		}

		isEqual(shape, value)
	})

	it('handle boolean array', () => {
		const shape = t.Object({
			name: t.String(),
			games: t.Array(t.Boolean())
		})

		const value = {
			name: 'saltyaom',
			games: [true, false, true]
		}

		isEqual(shape, value)
	})

	it('handle object array', () => {
		const shape = t.Object({
			name: t.String(),
			games: t.Array(
				t.Object({
					name: t.String(),
					hoursPlay: t.Number({ default: 0 }),
					tags: t.Array(t.String())
				})
			)
		})

		const value = {
			name: 'saltyaom',
			games: [
				{
					name: 'MiSide',
					hoursPlay: 17,
					tags: ['Psychological Horror', 'Cute', 'Dating Sim']
				},
				{
					name: 'Strinova',
					hoursPlay: 365,
					tags: ['Free to Play', 'Anime', 'Third-Person Shooter']
				},
				{
					name: "Tom Clancy's Rainbow Six Siege",
					hoursPlay: 287,
					tags: ['FPS', 'Multiplayer', 'Tactical']
				}
			]
		}

		isEqual(shape, value)
	})

	it('handle optional', () => {
		const shape = t.Object({
			name: t.String(),
			playing: t.Optional(t.String())
		})

		const value = {
			name: 'saltyaom'
		}

		isEqual(shape, value)
	})

	it('handle nullable', () => {
		const shape = t.Object({
			name: t.String(),
			country: Nullable(t.String())
		})

		const value = {
			name: 'saltyaom',
			country: null
		}

		isEqual(shape, value)
	})

	it('handle undefinable', () => {
		const shape = t.Object({
			name: t.String(),
			country: t.Union([t.String(), t.Undefined(), t.Null()])
		})

		const value = {
			name: 'saltyaom',
			// Transform undefined to null
			country: null
		}

		isEqual(shape, value)
	})

	it('handle intersect', () => {
		const shape = t.Intersect([
			t.Object({
				name: t.String(),
				playing: t.Optional(t.String())
			}),
			t.Object({
				country: t.String()
			})
		])

		const value = {
			name: 'saltyaom',
			country: 'Thailand'
		}

		isEqual(shape, value)
	})

	it('handle union', () => {
		const shape = t.Union([
			t.Object({
				name: t.String(),
				playing: t.Optional(t.String())
			}),
			t.Object({
				country: t.String()
			})
		])

		const value = {
			name: 'saltyaom',
			playing: 'MiSide'
		}

		isEqual(shape, value)
	})

	it('handle union with nullable', () => {
		const shape = t.Union([
			t.Object({
				name: t.String(),
				playing: t.Optional(t.String())
			}),
			t.Object({
				country: Nullable(t.String())
			})
		])

		const value = {
			country: null
		}

		isEqual(shape, value)
	})

	it('handle additionalProperties', () => {
		const shape = t.Object(
			{
				name: t.String(),
				playing: t.Optional(t.String())
			},
			{
				additionalProperties: true
			}
		)

		const value = {
			name: 'saltyaom',
			playing: 'Strinova'
		}

		isEqual(shape, value)
	})

	it('handle nullable array', () => {
		const shape = t.Object({
			name: t.String(),
			games: Nullable(t.Array(t.String()))
		})

		const value = {
			name: 'saltyaom',
			games: null
		}

		isEqual(shape, value)
	})

	it('handle nullable object', () => {
		const shape = t.Object({
			name: t.String(),
			metadata: Nullable(
				t.Object({
					alias: t.String()
				})
			)
		})

		const value = {
			name: 'saltyaom',
			metadata: null
		}

		isEqual(shape, value)
	})
})
