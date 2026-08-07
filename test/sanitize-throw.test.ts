import { describe, expect, it } from 'bun:test'
import { isEqual } from './utils'

import { Type as t } from 'typebox'

import { createAccelerator } from '../src'

describe('sanitize throw', () => {
	it('throw on invalid value', () => {
		const shape = t.Object({
			a: t.String(),
			b: t.String()
		})

		const value = {
			a: 'hello',
			b: 'hello\nworld'
		}

		expect(() =>
			createAccelerator(shape, {
				sanitize: 'throw'
			})(value)
		).toThrow()
	})

	it("don't throw on valid value", () => {
		const shape = t.Object({
			a: t.String(),
			b: t.String()
		})

		const value = {
			a: 'hello',
			b: 'hello world'
		}

		expect(() =>
			createAccelerator(shape, {
				sanitize: 'throw'
			})(value)
		).not.toThrow()

		isEqual(shape, value)
	})

	it("don't throw on valid value", () => {
		const shape = t.Object({
			a: t.String(),
			b: t.String({
				sanitize: true
			})
		})

		const value = {
			a: 'hello',
			b: 'hello world'
		}

		expect(() =>
			createAccelerator(shape, {
				sanitize: 'throw'
			})(value)
		).not.toThrow()

		isEqual(shape, value)
	})

	it('handle sanitize value', () => {
		const shape = t.Object({
			a: t.String(),
			b: t.String({
				sanitize: true
			})
		})

		const value = {
			a: 'hello',
			b: 'hello\nworld'
		}

		expect(() =>
			createAccelerator(shape, {
				sanitize: 'throw'
			})(value)
		).not.toThrow()

		isEqual(shape, value)
	})
})
