// primitive costs in Bun/JSC — drives codegen strategy choices
import { bench, run, group } from 'mitata'

const buf = Buffer.allocUnsafe(1 << 16)
const s8 = 'SaltyAom'
const s16 = 'SaltyAomSaltyAom'
const s30 = "Tom Clancy's Rainbow Six Siege"
const s80 = s16.repeat(5)
const esc = /[\x00-\x1f"\\]/
const enc = new TextEncoder()

const jsCopy = (s: string, p: number) => {
	const l = s.length
	let i = 0
	for (const l4 = l - 3; i < l4; i += 4) {
		const c0 = s.charCodeAt(i),
			c1 = s.charCodeAt(i + 1),
			c2 = s.charCodeAt(i + 2),
			c3 = s.charCodeAt(i + 3)
		if ((c0 | c1 | c2 | c3) > 127) break
		buf[p] = c0
		buf[p + 1] = c1
		buf[p + 2] = c2
		buf[p + 3] = c3
		p += 4
	}
	for (; i < l; i++) buf[p++] = s.charCodeAt(i)
	return p
}

group('copy 8 chars', () => {
	bench('buf.write', () => buf.write(s8, 0))
	bench('js loop', () => jsCopy(s8, 0))
	bench('encodeInto subarray', () => enc.encodeInto(s8, buf.subarray(0)))
})

group('copy 30 chars', () => {
	bench('buf.write', () => buf.write(s30, 0))
	bench('js loop', () => jsCopy(s30, 0))
})

group('copy 80 chars', () => {
	bench('buf.write', () => buf.write(s80, 0))
	bench('js loop', () => jsCopy(s80, 0))
})

group('escape scan 30', () => {
	bench('regex.test', () => esc.test(s30))
	bench('JSON.stringify', () => JSON.stringify(s30))
})

group('int to bytes', () => {
	let n = 365
	bench('itoa loop', () => {
		let p = 0
		let v = n
		const q = p
		while (v > 0) {
			buf[p++] = 48 + (v % 10)
			v = (v / 10) | 0
		}
		for (let l = q, r = p - 1; l < r; l++, r--) {
			const t = buf[l]
			buf[l] = buf[r]
			buf[r] = t
		}
		return p
	})
	bench("''+n then write", () => {
		const j = '' + n
		return buf.write(j, 0)
	})
})

group('number array', () => {
	const arr = [17, 365, 287]
	bench('toString+write', () => {
		const j = arr.toString()
		return buf.write(j, 0)
	})
	bench('itoa each', () => {
		let p = 0
		for (let i = 0; i < arr.length; i++) {
			if (i) buf[p++] = 44
			let v = arr[i]
			const q = p
			while (v > 0) {
				buf[p++] = 48 + (v % 10)
				v = (v / 10) | 0
			}
			for (let l = q, r = p - 1; l < r; l++, r--) {
				const t = buf[l]
				buf[l] = buf[r]
				buf[r] = t
			}
		}
		return p
	})
})

group('static 60B skeleton', () => {
	const chunk = Buffer.from('{"id":,"name":"SaltyAom","bio":"","user":{"name":"","password"')
	bench('chunk.copy', () => chunk.copy(buf, 0))
	bench('buf.set', () => buf.set(chunk, 0))
})

run()
