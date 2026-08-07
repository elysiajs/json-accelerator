/**
 * *-manual.ts is where end user specifiy which fields should be sanitized manually
 **/

import { Type as t } from 'typebox'
import { benchmark } from './utils'

benchmark(
	t.Object({
		id: t.Number(),
		name: t.String(),
		bio: t.String({
			sanitize: true
		}),
		metadata: t.Object({
			alias: t.String(),
			country: t.String()
		})
	}),
	{
		id: 1,
		name: 'SaltyAom',
		bio: 'I like train\n',
		metadata: {
			alias: 'SaltyAom',
			country: 'Thailand'
		}
	},
	{
		sanitize: 'manual'
	}
)
