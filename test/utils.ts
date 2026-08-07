import { Type as t, type TSchema } from 'typebox'
import { createAccelerator } from '../src/text/text'

import { expect } from 'bun:test'

export const isEqual = (shape: TSchema, value: unknown, expected = value) =>
	expect(JSON.parse(createAccelerator(shape)(value as any))).toEqual(expected)

export const Nullable = <T extends TSchema>(schema: T) =>
	t.Union([schema, t.Null()])
