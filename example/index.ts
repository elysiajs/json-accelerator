import { t } from 'elysia'
import { createAccelerator } from '../src/index'

const shape = t.Object({
	name: t.String({
		// trusted: true
	})
})

const string = `hi awd`

const value = {
	name: string
} satisfies typeof shape.static

const mirror = createAccelerator(shape)

console.log(JSON.parse(mirror(value)))
