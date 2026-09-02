/**
 * Swaps the package's entry points between the TypeScript source (what the
 * monorepo consumes) and the built `dist/` (what npm consumers need).
 *
 *   bun run scripts/pack-fields.ts dist    # prepack
 *   bun run scripts/pack-fields.ts source  # postpack
 *
 * `publishConfig` cannot do this: npm does not rewrite `main`/`exports` in the
 * packed package.json (verified with `npm pack`).
 */
import fs from 'node:fs'
import path from 'node:path'

const mode = process.argv[2]
if (mode !== 'dist' && mode !== 'source') {
	console.error('usage: pack-fields.ts <dist|source>')
	process.exit(1)
}

const file = path.join(import.meta.dir, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'))

const volar = { require: './volar.cjs', default: './volar.cjs' }

if (mode === 'dist') {
	pkg.main = './dist/vite.mjs'
	pkg.types = './dist/vite.d.mts'
	pkg.exports = {
		'.': { types: './dist/vite.d.mts', default: './dist/vite.mjs' },
		'./volar': volar,
		'./package.json': './package.json'
	}
} else {
	pkg.main = 'src/vite.ts'
	delete pkg.types
	pkg.exports = {
		'.': './src/vite.ts',
		'./volar': volar,
		'./package.json': './package.json'
	}
}

fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8')
console.log(`package.json entry points -> ${mode}`)
