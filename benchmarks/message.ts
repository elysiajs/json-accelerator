import { Type as t } from 'typebox'
import { benchmark } from './utils'

benchmark(
	t.Object({
		message: t.String({
			trusted: true
		})
	}),
	{ message: 'Hello, World!' as const }
)
