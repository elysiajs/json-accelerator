import { createAccelerator } from '../../src/text'
import { createByteEncoder } from '../../src'

import * as small from '../small'
import * as medium from '../medium'
import * as large from '../large'
import * as multipleQueries from '../multiple-queries'

const payloads = { small, medium, large, 'multiple-queries': multipleQueries }

const { model, value } = payloads[
	(process.env.PAYLOAD ?? 'medium') as keyof typeof payloads
] as { model: any; value: unknown }

const mode = process.env.MODE ?? 'stringify'
const port = Number(process.env.PORT ?? 3000)

const headers = { 'content-type': 'application/json' }

let handler: () => Response

if (mode === 'stringify')
	handler = () => new Response(JSON.stringify(value), { headers })
else if (mode === 'accelerator') {
	const encode = createAccelerator(model) as (v: unknown) => string
	handler = () => new Response(encode(value), { headers })
} else if (mode === 'bytes') {
	const encode = createByteEncoder(model) as (v: unknown) => Uint8Array
	handler = () =>
		new Response(encode(value) as unknown as BodyInit, { headers })
} else if (mode === 'static-string') {
	const body = JSON.stringify(value)
	handler = () => new Response(body, { headers })
} else if (mode === 'static-bytes') {
	const body = Buffer.from(JSON.stringify(value))
	handler = () => new Response(body as unknown as BodyInit, { headers })
} else throw new Error(`unknown MODE ${mode}`)

Bun.serve({ port, fetch: () => handler() })
console.log(`${mode} on :${port}`)
