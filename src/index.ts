import type { TAnySchema, TRecord } from '@sinclair/typebox'

const Kind = Symbol.for('TypeBox.Kind')
const OptionalKind = Symbol.for('TypeBox.Optional')

const isSpecialProperty = (name: string) => /(\ |-|\t|\n)/.test(name)

const joinProperty = (v1: string, v2: string | number) => {
	if (typeof v2 === 'number') return `${v1}[${v2}]`

	if (isSpecialProperty(v2)) return `${v1}["${v2}"]`

	return `${v1}.${v2}`
}

const encodeProperty = (v: string) => `"${v}"`

const isInteger = (schema: TAnySchema) => {
	if (!schema.anyOf || (Kind in schema && schema[Kind] !== 'Union'))
		return false

	let hasIntegerFormat = false
	let hasNumberType = false

	for (const type of schema.anyOf) {
		if (type.type === 'null' || type.type === 'undefined') {
			continue
		}

		if (
			!hasIntegerFormat &&
			type.type === 'string' &&
			type.format === 'integer'
		) {
			hasIntegerFormat = true
			continue
		}

		if (
			!hasNumberType &&
			(type.type === 'number' || type.type === 'integer')
		) {
			hasNumberType = true
			continue
		}

		return false
	}

	return hasIntegerFormat && hasNumberType
}

const getMetadata = (schema: TAnySchema) => {
	let isNullable = false
	let isUndefinable = false
	let newSchema

	if (!schema.anyOf || (Kind in schema && schema[Kind] !== 'Union'))
		return {
			schema,
			isNullable,
			isUndefinable
		}

	for (const type of schema.anyOf) {
		if (type.type === 'null') {
			isNullable = true
			continue
		}

		if (type.type === 'undefined') {
			isUndefinable = true
			continue
		}

		if (!newSchema) {
			newSchema = type
			continue
		}

		return {
			schema,
			isNullable,
			isUndefinable
		}
	}

	return {
		schema: newSchema,
		isNullable,
		isUndefinable
	}
}

export const mergeObjectIntersection = (schema: TAnySchema): TAnySchema => {
	if (
		!schema.allOf ||
		(Kind in schema &&
			(schema[Kind] !== 'Intersect' || schema.type !== 'object'))
	)
		return schema

	const { allOf, ...newSchema } = schema
	newSchema.properties = {}

	if (Kind in newSchema) newSchema[Kind as any] = 'Object'

	for (const type of allOf) {
		if (type.type !== 'object') continue

		const { properties, required, type: _, [Kind]: __, ...rest } = type

		if (required)
			newSchema.required = newSchema.required
				? newSchema.required.concat(required)
				: required

		Object.assign(newSchema, rest)

		for (const property in type.properties)
			newSchema.properties[property] = mergeObjectIntersection(
				type.properties[property]
			)
	}

	return newSchema
}

const isDateType = (schema: TAnySchema): boolean => {
	if (!schema.anyOf || (Kind in schema && schema[Kind] !== 'Union'))
		return false

	if (!schema.anyOf) return false

	let hasDateType = false
	let hasStringFormatDate = false
	let hasNumberType = false

	if (schema.anyOf)
		for (const type of schema.anyOf) {
			if (!hasDateType && type.type === 'Date') hasDateType = true

			if (
				!hasStringFormatDate &&
				type.type === 'string' &&
				(type.format === 'date' || type.format === 'date-time')
			)
				hasStringFormatDate = true

			if (!hasNumberType && type.type === 'number') hasNumberType = true
		}

	return hasDateType
}

interface Instruction {
	array: number
	optional: number
	properties: string[]
	/**
	 * If unsafe character is found, how should the encoder handle it?
	 *
	 * This value only applied to string field.
	 *
	 * - 'throw': Throw an error
	 * - 'ignore': Ignore the unsafe character, this implied that end user should handle it
	 * - 'sanitize': Sanitize the string and continue encoding
	 *
	 * @default 'sanitize'
	 **/
	sanitize: 'auto' | 'manual' | 'throw'
	definitions: Record<string, TAnySchema>
}

// equivalent to /["\n\r\t\b\f\v]/
const findEscapeSequence = /["\b\t\n\v\f\r\/]/

const SANITIZE = {
	auto: (property: string) =>
		`${findEscapeSequence}.test(${property})?JSON.stringify(${property}).slice(1,-1):${property}`,
	manual: (property: string) => `${property}`,
	throw: (property: string) =>
		`${findEscapeSequence}.test(${property})?(()=>{throw new Error("Property '${property}' contains invalid characters")})():${property}`
} satisfies Record<Instruction['sanitize'], (v: string) => string>

const joinStringArray = (p: string) =>
	`"$\{` +
	`((p)=>{` +
	`if(p.length===1)return p\n` +
	`let ars=''\n` +
	`for(let i=0;i<p.length;i++){` +
	`if(i===0)ars+=p[i]\n` +
	`else ars+=\`","\${p[i]}\`` +
	`}` +
	`return ars` +
	`})(${p})` +
	'}"'

const handleRecord = (
	schema: TRecord,
	property: string,
	instruction: Instruction
) => {
	const child =
		schema.patternProperties['^(.*)$'] ??
		schema.patternProperties[Object.keys(schema.patternProperties)[0]]

	if (!child) return property

	const i = instruction.array
	instruction.array++

	return (
		`\${((ar${i}n)=>{` +
		`const ar${i}s=Object.keys(ar${i}n);` +
		`let ar${i}v='{';` +
		`for(let i=0;i<ar${i}s.length;i++){` +
		`const ar${i}p=ar${i}n[ar${i}s[i]];` +
		`if(i!==0)ar${i}v+=',';` +
		`ar${i}v+=\`"\${ar${i}s[i]}":${accelerate(child, `ar${i}p`, instruction)}\`` +
		`}` +
		`return ar${i}v + '}'` +
		`})(${property})}`
	)
}

const accelerate = (
	schema: TAnySchema,
	property: string,
	instruction: Instruction
): string => {
	if (!schema) return ''

	if (
		Kind in schema &&
		schema[Kind] === 'Import' &&
		schema.$ref in schema.$defs
	)
		return accelerate(schema.$defs[schema.$ref], property, {
			...instruction,
			definitions: Object.assign(instruction.definitions, schema.$defs)
		})

	let v = ''
	const isRoot = property === 'v'

	const { schema: newSchema, isNullable, isUndefinable } = getMetadata(schema)
	schema = newSchema

	// const error = '' // `??(()=>{throw new Error("Property '${property}' is missing")})()`

	const nullableCondition =
		isNullable && isUndefinable
			? `${property}===null||${property}===undefined`
			: isNullable
				? `${property}===null`
				: isUndefinable
					? `${property}===undefined`
					: ''

	let sanitize = SANITIZE[instruction.sanitize]

	switch (schema.type) {
		case 'string':
			// string operation would be repeated multiple time
			// it's fine to optimize it to the most optimized way
			if (
				instruction.sanitize === 'auto' ||
				// Elysia specific format, this implied that format might contain unescaped JSON string
				schema.sanitize
			) {
				sanitize = SANITIZE['auto']

				// Sanitize use JSON.stringify which wrap double quotes
				// this handle the case where the string contains double quotes
				// As slice(1,-1) is use several compute and would be called multiple times
				// it's not ideal to slice(1, -1) of JSON.stringify
				if (nullableCondition) {
					if (schema.trusted)
						sanitize = (v: string) =>
							`\`"$\{${SANITIZE['manual'](v)}}"\``

					v = `\${${nullableCondition}?${schema.const !== undefined ? `'${JSON.stringify(schema.const)}'` : schema.default !== undefined ? `'${JSON.stringify(schema.default)}'` : `'null'`}:\`"\${${sanitize(property)}}"\`}`
				} else {
					if (schema.const !== undefined)
						v = JSON.stringify(schema.const)
					else if (schema.trusted)
						v = `"\${${SANITIZE['manual'](property)}}"`
					else v = `"\${${sanitize(property)}}"`
				}
			} else {
				// In this case quote is handle outside to improve performance
				if (nullableCondition)
					v = `\${${nullableCondition}?${schema.const !== undefined ? `'${JSON.stringify(schema.const)}'` : schema.default !== undefined ? `'${JSON.stringify(schema.default)}'` : `'null'`}:\`\\"\${${sanitize(property)}}\\"\`}`
				else
					v = `${schema.const !== undefined ? `${JSON.stringify(schema.const)}` : `"\${${sanitize(property)}}"`}`
			}

			break

		case 'number':
		case 'boolean':
		case 'bigint':
			if (nullableCondition)
				v = `\${${property}??${schema.default !== undefined ? schema.default : `'null'`}}`
			else v = `\${${property}}`
			break

		case 'null':
			v = `\${${property}}`
			break

		case 'undefined':
			break

		case 'object':
			if (nullableCondition) v += `\${${nullableCondition}?"null":\``

			v += '{'

			if (schema.additionalProperties) {
				v = `$\{JSON.stringify(${property})}`
				break
			}

			schema = mergeObjectIntersection(schema)

			let init = true
			let hasOptional = false
			let op = `op${instruction.optional}`

			if (schema[Kind as any] === 'Record') {
				v = handleRecord(schema as TRecord, property, instruction)

				break
			}

			if (
				!Object.keys(schema.properties).length &&
				schema.patternProperties
			) {
				v = `$\{JSON.stringify(${property})}`

				break
			}

			for (const key in schema.properties)
				if (OptionalKind in schema.properties[key]) {
					instruction.optional++
					hasOptional = true
					break
				}

			for (const key in schema.properties) {
				const isOptional = OptionalKind in schema.properties[key]
				const name = joinProperty(property, key)
				const hasShortName =
					schema.properties[key].type === 'object' &&
					!name.startsWith('ar') &&
					Object.keys(schema.properties).length > 5

				const i = instruction.properties.length
				if (hasShortName) instruction.properties.push(name)

				const k = encodeProperty(key)
				const p = accelerate(
					schema.properties[key],
					hasShortName ? `s${i}` : name,
					instruction
				)

				const comma = `\${${op}?',':(${op}=true)&&''}`

				let defaultValue = schema.properties[key].default
				if (defaultValue !== undefined) {
					if (typeof defaultValue === 'string')
						defaultValue = `"${defaultValue}"`

					defaultValue = `\`${comma}${k}:${defaultValue}\``
				} else defaultValue = '""'

				v += isOptional
					? `\${(${name}===undefined?${defaultValue}:\`${comma}${k}:${p}\`)}`
					: hasOptional
						? `${!init ? ',' : `\${(${op}=true)&&""}`}${k}:${p}`
						: `${!init ? ',' : ''}${k}:${p}`

				init = false
			}

			v += '}'

			if (nullableCondition) v += `\`}`

			break

		case 'array':
			const i = instruction.array

			instruction.array++

			if (schema.items.type === 'string') {
				if (isRoot) v += 'return `'

				if (nullableCondition)
					v += `\${${nullableCondition}?"null":${property}.length?\`[${joinStringArray(property)}]\`:"[]"}`
				else
					v += `\${${property}.length?\`[${joinStringArray(property)}]\`:"[]"}`

				if (isRoot) v += '`'

				break
			}

			if (
				schema.items.type === 'number' ||
				schema.items.type === 'boolean' ||
				schema.items.type === 'bigint' ||
				isInteger(schema.items)
			) {
				if (isRoot) v += 'return `'

				if (nullableCondition)
					v += `\${${nullableCondition}?'"null"':${property}.length?\`[$\{${property}.toString()}]\`:"[]"`
				else
					v += `\${${property}.length?\`[$\{${property}.toString()}]\`:"[]"}`

				if (isRoot) v += '`'

				break
			}

			if (isNullable || isUndefinable) v += `\${!${property}?'"null"':\``

			if (isRoot) v += `const ar${i}s=${property};`
			else v += `\${((ar${i}s)=>{`

			v +=
				`let ar${i}v='[';` +
				`for(let i=0;i<ar${i}s.length;i++){` +
				`const ar${i}p=ar${i}s[i];` +
				`if(i!==0){ar${i}v+=','}` +
				`ar${i}v+=\`${accelerate(schema.items, `ar${i}p`, instruction)}\`` +
				`}` +
				`return ar${i}v+']'`

			if (!isRoot) v += `})(${property})}`

			if (isNullable || isUndefinable) v += `\`}`

			break

		default:
			if (schema.$ref && schema.$ref in instruction.definitions)
				return accelerate(
					instruction.definitions[schema.$ref],
					property,
					instruction
				)

			if (isDateType(schema)) {
				if (isNullable || isUndefinable)
					v = `\${${nullableCondition}?${schema.default !== undefined ? `'"${schema.default}"'` : "'null'"}:typeof ${property}==="object"?\`\"\${${property}.toISOString()}\"\`:${property}}`
				else {
					v = `\${typeof ${property}==="object"?\`\"\${${property}.toISOString()}\"\`:${property}}`
				}

				break
			}

			if (isInteger(schema)) {
				if (nullableCondition)
					v = `\${${property}??${schema.default !== undefined ? schema.default : `'null'`}}`
				else v = `\${${property}}`

				break
			}

			v = `$\{JSON.stringify(${property})}`

			break
	}

	if (!isRoot) return v

	const isArray = schema.type === 'array'
	if (!isArray) v = `\`${v}\``

	let setup = ''

	if (instruction.optional) {
		setup += 'let '

		for (let i = 0; i < instruction.optional; i++) {
			if (i !== 0) setup += ','
			setup += `op${i}=false`
		}

		setup += '\n'
	}

	if (instruction.properties.length) {
		setup += 'const '

		for (let i = 0; i < instruction.properties.length; i++) {
			if (i !== 0) setup += ','
			setup += `s${i}=${instruction.properties[i]}`
		}

		setup += '\n'
	}

	if (isArray) return setup + '\n' + v

	return setup + 'return ' + v
}

export const createAccelerator = <T extends TAnySchema>(
	schema: T,
	{
		sanitize = 'auto',
		definitions = {}
	}: Partial<Pick<Instruction, 'sanitize' | 'definitions'>> = {}
): ((v: T['static']) => string) => {
	const f = accelerate(schema, 'v', {
		array: 0,
		optional: 0,
		properties: [],
		sanitize,
		definitions
	})

	return Function('v', f) as any
}

export default createAccelerator

// const shape = t.Object({
// 	a: t.Nullable(
// 		t.Object({
// 			a: t.String()
// 		})
// 	)
// })

// const shape = t.Object({
// 	a: t.String(),
// 	social: t.Optional(
// 		t.Object({
// 			facebook: t.Nullable(t.String()),
// 			twitter: t.Nullable(t.String()),
// 			youtube: t.Nullable(t.String())
// 		})
// 	)
// })

// const stringify = createaccelerate(shape)

// console.log(
// 	stringify({
// 		a: 'a',
// 		social: {
// 			a: 'a',
// 		}
// 	})
// )
