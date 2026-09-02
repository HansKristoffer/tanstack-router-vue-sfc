import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { build, type Rollup } from 'vite'
import { tanstackRouterSfc } from '../src/vite'

/**
 * End-to-end guard: builds a fixture app with the real plugin chain.
 *
 * This is the test that catches an upstream `@tanstack/router-plugin` change,
 * because everything it asserts depends on how the official generator emits
 * the route tree.
 */

const FIXTURE = path.join(import.meta.dir, 'fixture')

let outDir: string
let chunks: Array<Rollup.OutputChunk>
let routeTree: string

function chunkContaining(marker: string): Rollup.OutputChunk | undefined {
	return chunks.find((chunk) => chunk.code.includes(marker))
}

beforeAll(async () => {
	// Build a copy, so the generated route tree never lands in the fixture.
	// It has to sit inside the package (not in $TMPDIR) or the fixture cannot
	// resolve `vue` / `@tanstack/vue-router` from the monorepo's node_modules.
	outDir = fs.mkdtempSync(path.join(import.meta.dir, '..', '.test-build-'))
	fs.cpSync(FIXTURE, outDir, { recursive: true })

	const result = (await build({
		root: outDir,
		logLevel: 'silent',
		plugins: [...tanstackRouterSfc(), vue()],
		build: { write: false, minify: false }
	})) as Rollup.RollupOutput | Array<Rollup.RollupOutput>

	const output = Array.isArray(result) ? result[0]!.output : result.output
	chunks = output.filter(
		(item): item is Rollup.OutputChunk => item.type === 'chunk'
	)
	routeTree = fs.readFileSync(
		path.join(outDir, 'src/routeTree.gen.ts'),
		'utf-8'
	)
}, 60_000)

afterAll(() => {
	if (outDir) fs.rmSync(outDir, { recursive: true, force: true })
})

describe('generated route tree', () => {
	test('keeps the .vue extension on single-file route imports', () => {
		expect(routeTree).toContain("from './routes/index.vue'")
		expect(routeTree).toContain("from './routes/about.vue'")
		expect(routeTree).toContain("from './routes/__root.vue'")
	})

	test('still wires an old-style pair through lazyRouteComponent', () => {
		expect(routeTree).toMatch(/from '\.\/routes\/pair(\.ts)?'/)
		expect(routeTree).toContain("import('./routes/pair.component.vue')")
	})
})

describe('code splitting', () => {
	test('each single-file route component gets its own chunk', () => {
		const index = chunkContaining('fixture-index-marker')
		const about = chunkContaining('fixture-about-marker')
		expect(index).toBeDefined()
		expect(about).toBeDefined()
		expect(index?.fileName).not.toBe(about?.fileName)
		expect(index?.isEntry).toBe(false)
		expect(about?.isEntry).toBe(false)
	})

	test('the eager route definitions carry no component markup', () => {
		const eager = chunkContaining('FIXTURE_INDEX_LOADER')
		expect(eager).toBeDefined()
		expect(eager?.code).not.toContain('fixture-index-marker')
		expect(eager?.code).not.toContain('fixture-about-marker')
	})

	test("a route's options are split away from its component", () => {
		// `validateSearch` belongs to /about. Whichever chunk carries it must not
		// also carry /about's markup - that separation is the whole point.
		const options = chunkContaining('validateSearch')
		expect(options).toBeDefined()
		expect(options?.code).not.toContain('fixture-about-marker')
		expect(options?.code).toContain('lazyRouteComponent')
	})
})
