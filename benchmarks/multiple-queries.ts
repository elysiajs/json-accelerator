import { Type as t } from 'typebox'
import { benchmark } from './utils'

benchmark(
	t.Array(
		t.Object({
			id: t.Number(),
			randomNumber: t.Number()
		})
	),
	[
		{ id: 4174, randomNumber: 331 },
		{ id: 51, randomNumber: 6544 },
		{ id: 4462, randomNumber: 952 },
		{ id: 2221, randomNumber: 532 },
		{ id: 9276, randomNumber: 3097 },
		{ id: 3056, randomNumber: 7293 },
		{ id: 6964, randomNumber: 620 },
		{ id: 675, randomNumber: 6601 },
		{ id: 8414, randomNumber: 6569 },
		{ id: 2753, randomNumber: 4065 }
	]
)
