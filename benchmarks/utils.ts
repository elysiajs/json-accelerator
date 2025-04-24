import { bench, run, barplot, summary, compact, do_not_optimize } from 'mitata'

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
				bench('JSON Stingify', () => {
                    do_not_optimize( () => {
					    const result = JSON.stringify(value)
					    return result
                    })
				})

				bench('Fast Json Stringify', () => {
				    do_not_optimize( () => {	
                        const result = fastJsonStringify(value)
                        return result
                    })
				})

				bench('JSON Accelerator', () => {
					do_not_optimize( () => {
                        const result = encode(value)
					    return result
                    })
				})

				const validator = TypeCompiler.Compile(model)

				bench('JSON Accelerator w/ validation', () => {
				    do_not_optimize( () => {	
                        validator.Check(value)
                        const result = encode(value)
                        return result
                    })
				})
			})
		})
	})

	run()
}
