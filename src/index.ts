import type { TSchema, Static } from 'typebox'

type TAnySchema = TSchema & Record<string, any>

const kindOf = (schema: any) => schema['~kind']
const isOptionalSchema = (schema: any) =>
	schema['~optional'] === true

const isIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/

// Memoization caches
const isIntegerCache = new WeakMap<TAnySchema, boolean>()
const metadataCache = new WeakMap<
	TAnySchema,
	{ schema: TAnySchema; isNullable: boolean; isUndefinable: boolean }
>()

export const access = (base: string, key: string) =>
	isIdentifier.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`

// JSON key literal in the output — always quoted
const encodeProperty = (v: string) => JSON.stringify(v)

function isInteger(schema: TAnySchema) {
	if (isIntegerCache.has(schema)) return isIntegerCache.get(schema)!

	const kind = kindOf(schema)
	if (!schema.anyOf || (kind !== undefined && kind !== 'Union')) {
		isIntegerCache.set(schema, false)
		return false
	}

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

		isIntegerCache.set(schema, false)
		return false
	}

	const result = hasIntegerFormat && hasNumberType
	isIntegerCache.set(schema, result)

	return result
}

function getMetadata(schema: TAnySchema) {
	if (metadataCache.has(schema)) return metadataCache.get(schema)!

	let isNullable = false
	let isUndefinable = false
	let newSchema

	const kind = kindOf(schema)
	if (!schema.anyOf || (kind !== undefined && kind !== 'Union')) {
		const result = {
			schema,
			isNullable,
			isUndefinable
		}
		metadataCache.set(schema, result)

		return result
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

		const result = {
			schema,
			isNullable,
			isUndefinable
		}
		metadataCache.set(schema, result)

		return result
	}

	const result = {
		schema: newSchema,
		isNullable,
		isUndefinable
	}

	metadataCache.set(schema, result)
	return result
}

export function mergeObjectIntersection(schema: TAnySchema): TAnySchema {
	const kind = kindOf(schema)
	if (
		!schema.allOf ||
		(kind !== undefined && kind !== 'Intersect') ||
		// only merge intersections of objects
		!schema.allOf.every(
			(type: TAnySchema) => type.type === 'object' || type.allOf
		)
	)
		return schema

	const { allOf, ...newSchema } = schema
	newSchema.properties = {}
	newSchema.type = 'object'
	if ('~kind' in schema) newSchema['~kind'] = 'Object'

	for (const type of allOf) {
		if (type.type !== 'object') continue

		const { properties, required, type: _, ...rest } = type

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

const findEscapeSequence = /[\x00-\x1F"\\]/

const SANITIZE = {
	auto: (property: string) =>
		`fe.test(${property})?JSON.stringify(${property}).slice(1,-1):${property}`,
	manual: (property: string) => `${property}`,
	throw: (property: string) =>
		`fe.test(${property})?(()=>{throw new Error("Property '${property}' contains invalid characters")})():${property}`
} satisfies Record<Instruction['sanitize'], (v: string) => string>

const joinStringArray = (p: string) => `"\${jsa(${p})}"`

const SHARED: [marker: string, decl: string][] = [
	['fe.test(', `const fe=${findEscapeSequence}\n`],
	[
		'jsa(',
		`const jsa=(p)=>{` +
			`if(p.length===1)return p\n` +
			`let ars=p[0]\n` +
			`for(let i=1;i<p.length;i++){` +
			`ars=\`\${ars}","\${p[i]}\`` +
			`}` +
			`return ars}\n`
	]
]
function handleRecord(
	schema: TAnySchema,
	property: string,
	instruction: Instruction
) {
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

function accelerate(
	schema: TAnySchema,
	property: string,
	instruction: Instruction
) {
	if (!schema) return ''

	if (schema.$defs && schema.$ref in schema.$defs)
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
		case 'integer':
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

			if (kindOf(schema) === 'Record') {
				v = handleRecord(schema, property, instruction)

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
				if (isOptionalSchema(schema.properties[key])) {
					instruction.optional++
					hasOptional = true
					break
				}

			for (const key in schema.properties) {
				const isOptional = isOptionalSchema(schema.properties[key])
				const name = access(property, key)
				const hasShortName =
					schema.properties[key].type === 'object' &&
					!name.startsWith('ar')

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
					v += `\${${nullableCondition}?'"null"':${property}.length?\`[$\{${property}.toString()}]\`:"[]"}`
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
				`if(i!==0){ar${i}v=\`\${ar${i}v},\`}` +
				`ar${i}v=\`\${ar${i}v}${accelerate(schema.items, `ar${i}p`, instruction)}\`` +
				`}` +
				`return \`\${ar${i}v}]\``

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

	for (const [marker, decl] of SHARED) if (v.includes(marker)) setup += decl

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

export const createAccelerator = <T extends TSchema>(
	schema: T,
	{
		sanitize = 'auto',
		definitions = {}
	}: Partial<Pick<Instruction, 'sanitize' | 'definitions'>> = {}
): ((v: Static<T>) => string) => {
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
