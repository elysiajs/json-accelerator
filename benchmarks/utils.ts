import { bench, run, barplot, summary, compact } from 'mitata'

import { createAccelerator } from '../src/text'
import { createByteEncoder } from '../src'
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

				// bench('JSON Accelerator', () => new Response(value, {
				// 	headers: {
				// 		'content-type': 'application/json'
				// 	}
				// }))

				// bench('JSON Accelerator (bytes)', () => new Response(value, {
				// 	headers: {
				// 		'content-type': 'application/json'
				// 	}
				// }))

				// bench('Fast JSON Stringify', () =>
				// 	new Response(fastJsonStringify(value), {
				// 		headers: {
				// 			'content-type': 'application/json'
				// 		}
				// 	})
				// )

				// bench('JSON Stringify', () => new Response(JSON.stringify(value), {
				// 	headers: {
				// 		'content-type': 'application/json'
				// 	}
				// }))

				// bench('Response.json', () => Response.json(value))
			})
		})
	})

	run()
}
