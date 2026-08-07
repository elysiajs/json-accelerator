import { Type as t } from 'typebox'
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
]

const mirror = createAccelerator(shape, {
	// worker: true
})

console.log(mirror.toString())

console.log(await mirror(value))
