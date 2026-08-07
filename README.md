# JSON Accelerator

Accelerate JSON stringification by providing OpenAPI/TypeBox model.

By providing model ahead of time, the library will generate a function that will serialize the object into a Uint8Array which doesn't need to be re-encode by Response.

```
$ npx tsx benchmarks/medium-manual.ts

clk: ~3.02 GHz
cpu: Apple M1 Max
runtime: node 22.6.0 (arm64-darwin)

summary
  JSON Accelerator
   2.12x faster than JSON Stingify
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

It is designed to be used with [TypeBox 1+](https://github.com/sinclairzx81/typebox) but an OpenAPI schema should also work.

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
import { Type as t } from 'typebox'
import { Compile } from 'typebox/compile'
import { createAccelerator } from 'json-accelerator'

const shape = t.Object({
	name: t.String(),
	id: t.Number()
})

const value = {
	id: 0,
	name: 'saltyaom'
}

const guard = Compile(shape)
const encode = createAccelerator(shape)

if (guard.Check(value)) encode(value)
```

If the shape is incorrect, the output will try to corece the value into an expected model but if failed the error will be thrown.
