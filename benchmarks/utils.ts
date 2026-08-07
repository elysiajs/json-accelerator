import { bench, run, barplot, summary, compact } from 'mitata'

import { createAccelerator } from '../src'
import { createByteEncoder } from '../src/bytes'
import fastJson from 'fast-json-stringify'

import type { TSchema, Static } from 'typebox'

export const benchmark = <T extends TSchema>(
	model: T,
	value: Static<T>,
	options?: Parameters<typeof createAccelerator>[1]
) => {
	const fastJsonStringify = fastJson(model as any)
	const encode = createAccelerator(model, options) as (v: unknown) => string
	const encodeBytes = createByteEncoder(model)

	if (process.env.DEBUG) {
		console.log(encode.toString())
	}

	if (encode(value) !== JSON.stringify(value)) {
		console.log(encode(value))
		console.log('---')
		console.log(encode.toString())
		throw new Error('Invalid result')
	}

	if (Buffer.from(encodeBytes(value)).toString() !== JSON.stringify(value)) {
		console.log(Buffer.from(encodeBytes(value)).toString())
		throw new Error('Invalid bytes result')
	}

	// Every bench encodes to UTF-8 bytes: a Response has to flatten the string
	// and encode it anyway, so measuring string creation alone hides the rope
	// flattening cost of template-literal output.
	const enc = new TextEncoder()

	compact(() => {
		barplot(() => {
			summary(() => {
				bench('JSON Accelerator', () => enc.encode(encode(value)))

				bench('JSON Accelerator (bytes)', () => encodeBytes(value))

				bench('Fast JSON Stringify', () =>
					enc.encode(fastJsonStringify(value))
				)

				bench('JSON Stringify', () => enc.encode(JSON.stringify(value)))
			})
		})
	})

	run()
}
