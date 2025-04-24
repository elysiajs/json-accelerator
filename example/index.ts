import { t } from 'elysia'
import { createAccelerator } from '../src/index'

const shape = t.Array(
	t.Object({
		name: t.String()
	})
)

const value = [
	{
		name: 'a'
	},
	{
		name: 'b'
	}
] satisfies typeof shape.static

const mirror = createAccelerator(shape)

console.log((mirror(value)))
