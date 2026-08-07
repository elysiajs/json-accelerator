import { describe, it, expect } from 'bun:test'
import { isEqual } from './utils'

import { Type as t } from 'typebox'

import { createAccelerator } from '../src'

describe('Ref', () => {
	it('handle module', () => {
		const modules = t.Module({
			object: t.Object({
				name: t.String(),
				optional: t.Optional(t.String())
			})
		})

		const shape = modules.object

		const value = {
			name: 'salt'
		}

		isEqual(shape, value)
	})

	it('handle nested ref', () => {
		const modules = t.Module({
			object: t.Object({
				name: t.String(),
				info: t.Ref('info')
			}),
			info: t.Object({
				id: t.Number(),
				name: t.String()
			})
		})

		const shape = modules.object

		const value = {
			name: 'salt',
			info: {
				id: 123,
				name: 'salt'
			}
		}

		isEqual(shape, value)
	})

	it('handle optional ref', () => {
		const modules = t.Module({
			object: t.Object({
				name: t.String(),
				info: t.Optional(t.Ref('info'))
			}),
			info: t.Object({
				id: t.Number(),
				name: t.String()
			})
		})

		const shape = modules.object

		const value = {
			name: 'salt'
		}

		isEqual(shape, {
			name: 'salt'
		})

		isEqual(shape, {
			name: 'salt',
			info: {
				id: 123,
				name: 'salt'
			}
		})
	})

	it('handle custom modules', () => {
		const definitions = {
			object: t.Object({
				name: t.String(),
				optional: t.Optional(t.String())
			})
		}

		const shape = definitions.object

		const value = {
			name: 'salt'
		}

		expect(
			createAccelerator(shape, {
				definitions
			})(value)
		).toEqual(JSON.stringify(value))
	})
})
