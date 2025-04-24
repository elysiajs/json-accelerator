# JSON Accelerator

Accelerate JSON stringification by providing OpenAPI/TypeBox model.

By providing model ahead of time, the library will generate a function that will serialize the object into a JSON string.

```
$ npx tsx benchmarks/medium-manual.ts

clk: ~3.02 GHz
cpu: Apple M1 Max
runtime: node 22.6.0 (arm64-darwin)

summary
  JSON Accelerator
   2.12x faster than JSON Stringify
   2.66x faster than Fast Json Stringify
```

## Installation

```bash
# Using either one of the package manager
npm install json-accelerator
yarn add json-accelerator
pnpm add json-accelerator
bun add json-accelerator
```

## Usage

It is designed to be used with [TypeBox](https://github.com/sinclairzx81/typebox) but an OpenAPI schema should also work.

```typescript
import { Type as t } from '@sinclair/typebox'
import { createAccelerator } from 'json-accelerator'

const shape = t.Object({
	name: t.String(),
	id: t.Number()
})

const value = {
	id: 0,
	name: 'saltyaom'
} satisfies typeof shape.static

const encode = createAccelerator(shape)

console.log(encode(value)) // {"id":0,"name":"saltyaom"}
```

## Caveat

This library **WILL NOT** check for the type validity of the schema, it is expected that the schema is **always** correct.

This can be achieved by checking the input validity with TypeBox before passing it to the accelerator.

```typescript
import { Type as t } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { createAccelerator } from 'json-accelerator'

const shape = t.Object({
	name: t.String(),
	id: t.Number()
})

const value = {
	id: 0,
	name: 'saltyaom'
}

const guard = TypeCompiler.Compile(shape)
const encode = createAccelerator(shape)

if (guard.Check(value)) encode(value)
```

If the shape is incorrect, the output will try to corece the value into an expected model but if failed the error will be thrown.

## Options

This section is used to configure the behavior of the encoder.

`Options` can be passed as a second argument to `createAccelerator`.

```ts
createAccelerator(shape, {
	unsafe: 'throw'
})
```

## Unsafe

If unsafe character is found, how should the encoder handle it?

This value only applied to string field.

- `'auto'`: Sanitize the string and continue encoding
- `'manual'`: Ignore the unsafe character, this implied that end user should specify fields that should be sanitized manually
- `'throw'`: Throw an error

The default behavior is `auto`.

### format sanitize

Since this library is designed for a controlled environment (eg. Restful API), most fields are controlled by end user which doesn't include unsafe characters for JSON encoding.

We can improve performance by specifying a `sanitize: 'manual'` and provide a field that should be sanitized manually.

We can add `sanitize: true` to a schema which is an uncontrolled field submit by user that might contains unsafe characters.

When a field is marked as `sanitize`, the encoder will sanitize the string and continue encoding regardless of the `unsafe` configuration.

```ts
import { Type as t } from '@sinclair/typebox'
import { createAccelerator } from 'json-accelerator'

const shape = t.Object({
	name: t.String(),
	id: t.Number(),
	unknown: t.String({ sanitize: true })
})

const value = {
	id: 0,
	name: 'saltyaom',
	unknown: `hello\nworld`
} satisfies typeof shape.static

const encode = createAccelerator(shape, {
	sanitize: 'manual'
})

console.log(encode(value)) // {"id":0,"name":"saltyaom","unknown":"hello\\nworld"}
```

This allows us to speed up a hardcode
