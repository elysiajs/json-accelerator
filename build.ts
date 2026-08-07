import { $ } from 'bun'
import { build } from 'tsdown'

await $`rm -rf dist`

await build({
	outDir: 'dist',
	entry: ['src/**/*.ts'],
	cjsDefault: false,
	target: 'node22',
	format: ['esm', 'cjs'],
	minify: false,
	unbundle: true,
	dts: true,
	outExtensions(c) {
		return {
			dts: '.d.ts',
			js: c.format === 'es' ? '.mjs' : '.js'
		}
	}
})
