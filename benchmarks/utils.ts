import { bench, run, barplot, summary } from 'mitata'

import { createAccelerator } from '../src'
import fastJson from 'fast-json-stringify'
import type { TAnySchema } from '@sinclair/typebox'

export const benchmark = <T extends TAnySchema>(
	model: T,
	value: T['static']
) => {
	const fastJsonStringify = fastJson(model)
	const encode = createAccelerator(model)

	if (encode(value) !== JSON.stringify(value))
		throw new Error('Invalid result')

	barplot(() => {
		summary(() => {
			bench('JSON Stingify', () => {
				return JSON.stringify(value)
			})

			bench('Fast Json Stringify', () => {
				return fastJsonStringify(value)
			})

			bench('JSON Accelerator', () => {
				return encode(value)
			})
		})
	})

	run()
}
