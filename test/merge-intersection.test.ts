import { describe, expect, it } from 'bun:test'

import { Type as t } from '@sinclair/typebox'

import { mergeObjectIntersection } from '../src/text/text'

describe('Merge Object Intersection', () => {
	it('work', () => {
		expect(
			mergeObjectIntersection(
				t.Intersect([
					t.Object({
						a: t.String()
					}),
					t.Object({
						b: t.String()
					})
				])
			)
		).toEqual(
			t.Object({
				a: t.String(),
				b: t.String()
			})
		)
	})

	it('handle nested intersection', () => {
		expect(
			mergeObjectIntersection(
				t.Intersect([
					t.Object({
						a: t.String()
					}),
					t.Object({
						b: t.Intersect([
							t.Object({
								c: t.String()
							}),
							t.Object({
								d: t.String()
							})
						])
					})
				])
			)
		).toEqual(
			t.Object({
				a: t.String(),
				b: t.Object({
					c: t.String(),
					d: t.String()
				})
			})
		)
	})

	it('merge property', () => {
		expect(
			mergeObjectIntersection(
				t.Intersect([
					t.Object(
						{
							a: t.String()
						},
						{
							description: 'ok'
						}
					),
					t.Object(
						{
							b: t.Number({
								minimum: 0
							})
						},
						{
							additionalProperties: true
						}
					)
				])
			)
		).toEqual(
			t.Object(
				{
					a: t.String(),
					b: t.Number({
						minimum: 0
					})
				},
				{
					description: 'ok',
					additionalProperties: true
				}
			)
		)
	})
})
