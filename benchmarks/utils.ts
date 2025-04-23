import { bench, run, barplot, summary, compact } from 'mitata'

import { createAccelerator } from '../src'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import fastJson from 'fast-json-stringify'

import type { TAnySchema } from '@sinclair/typebox'

export const benchmark = <T extends TAnySchema>(
	model: T,
	value: T['static'],
	options?: Parameters<typeof createAccelerator>[1]
) => {
	const fastJsonStringify = fastJson(model)
	const encode = createAccelerator(model, options)

	if (process.env.DEBUG) {
		console.log(encode.toString())
	}

	if (encode(value) !== JSON.stringify(value)) {
		console.log(encode(value))
		console.log('---')
		console.log(encode.toString())
		throw new Error('Invalid result')
	}

	compact(() => {
		barplot(() => {
			summary(() => {
				bench('JSON Stringify', () => {
					return JSON.stringify(value)
				})

				bench('Fast Json Stringify', () => {
					return fastJsonStringify(value)
				})

				bench('JSON Accelerator', () => {
					return encode(value)
				})

				const validator = TypeCompiler.Compile(model)

				bench('JSON Accelerator w/ validation', () => {
					validator.Check(value)

					return encode(value)
				})
			})
		})
	})

	run()
}
