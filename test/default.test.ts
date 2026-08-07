import { describe, it } from 'bun:test'
import { isEqual, Nullable } from './utils'

import { Type as t } from 'typebox'

describe('Default', () => {
	it('handle default value for optional string', () => {
		const shape = t.Object({
			name: t.String(),
			playing: t.Optional(t.String({ default: 'Strinova' }))
		})

		const value = {
			name: 'saltyaom'
		}

		isEqual(shape, value, {
			name: 'saltyaom',
			playing: 'Strinova'
		})
	})

	it('handle default value for optional number', () => {
		const shape = t.Object({
			name: t.String(),
			playing: t.Optional(t.Number({ default: 2 }))
		})

		const value = {
			name: 'saltyaom'
		}

		isEqual(shape, value, {
			name: 'saltyaom',
			playing: 2
		})
	})

	it('handle default value for optional boolean', () => {
		const shape = t.Object({
			name: t.String(),
			playing: t.Optional(t.Boolean({ default: true }))
		})

		const value = {
			name: 'saltyaom'
		}

		isEqual(shape, value, {
			name: 'saltyaom',
			playing: true
		})
	})

	it('handle default value for optional integer', () => {
		const shape = t.Object({
			name: t.String(),
			playing: t.Optional(t.Integer({ default: 2 }))
		})

		const value = {
			name: 'saltyaom'
		}

		isEqual(shape, value, {
			name: 'saltyaom',
			playing: 2
		})
	})

	it('handle default value for optional bigint', () => {
		const shape = t.Object({
			name: t.String(),
			playing: t.Optional(t.BigInt({ default: BigInt(2) }))
		})

		const value = {
			name: 'saltyaom'
		}

		isEqual(shape, value, {
			name: 'saltyaom',
			playing: 2
		})
	})

	it('handle default value nullable string', () => {
		const shape = t.Object({
			name: t.String(),
			playing: Nullable(t.String({ default: 'Strinova' }))
		})

		const value = {
			name: 'saltyaom',
			playing: null
		}

		isEqual(shape, value, {
			name: 'saltyaom',
			playing: 'Strinova'
		})
	})

	it('handle default value nullable number', () => {
		const shape = t.Object({
			name: t.String(),
			playing: Nullable(t.Number({ default: 2 }))
		})

		const value = {
			name: 'saltyaom',
			playing: null
		}

		isEqual(shape, value, {
			name: 'saltyaom',
			playing: 2
		})
	})

	it('handle default value nullable boolean', () => {
		const shape = t.Object({
			name: t.String(),
			playing: Nullable(t.Boolean({ default: true }))
		})

		const value = {
			name: 'saltyaom',
			playing: null
		}

		isEqual(shape, value, {
			name: 'saltyaom',
			playing: true
		})
	})

	it('handle default value nullable integer', () => {
		const shape = t.Object({
			name: t.String(),
			playing: Nullable(t.Integer({ default: 2 }))
		})

		const value = {
			name: 'saltyaom',
			playing: null
		}

		isEqual(shape, value, {
			name: 'saltyaom',
			playing: 2
		})
	})

	it('handle default value nullable bigint', () => {
		const shape = t.Object({
			name: t.String(),
			playing: Nullable(t.BigInt({ default: BigInt(2) }))
		})

		const value = {
			name: 'saltyaom',
			playing: null
		}

		isEqual(shape, value, {
			name: 'saltyaom',
			playing: 2
		})
	})

})
