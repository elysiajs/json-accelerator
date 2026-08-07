import { Type as t } from 'typebox'
import { createByteEncoder } from '../src'

const shape = t.Array(
	t.Object({
		name: t.String()
	})
)

const value = [
	{
		name: 'a',
		b: 'aawd'
	},
	{
		name: 'b'
	}
]

const mirror = createByteEncoder(shape, {
	// worker: true
})

// console.log(mirror.toString())

console.log(mirror(value).toString())
