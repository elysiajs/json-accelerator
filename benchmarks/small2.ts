import { Type as t } from 'typebox'
import { benchmark } from './utils'

benchmark(
	t.Array(
		t.Object({
			name: t.String(),
			pwd: t.String(),
			id: t.Array(t.Number())
		})
	),
	[
		{
			name: 'SaltyAom',
			pwd: 'password',
			id: [1, 2, 3]
		},
		{
			name: 'JohnDoe',
			pwd: 'password',
			id: [4, 5, 6]
		},
		{
			name: 'JaneDoe',
			pwd: 'password',
			id: [7, 8, 9]
		}
	]
)
