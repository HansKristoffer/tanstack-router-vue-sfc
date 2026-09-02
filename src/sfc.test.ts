import { describe, expect, test } from 'bun:test'
import {
	buildRouterModule,
	checkRouterBlock,
	parseRouteSfc,
	replaceRouteId,
	rewriteRouteSfc,
	RouteSfcError
} from './sfc'

const SFC = `<template>
	<h1>{{ title }}</h1>
</template>

<script setup lang="ts">
const title = Route.useLoaderData()
</script>

<router lang="ts">
import { createFileRoute } from '@tanstack/vue-router'

export default createFileRoute('/posts/$postId')({
	loader: () => 'hi'
})
</router>
`

const countLines = (value: string) => value.split('\n').length

describe('parseRouteSfc', () => {
	test('locates the block and its tag bounds', () => {
		const sfc = parseRouteSfc(SFC)
		expect(sfc.block).not.toBeNull()
		expect(sfc.hasTemplate).toBe(true)
		expect(sfc.hasScriptSetup).toBe(true)
		expect(sfc.plainScriptContentStart).toBeNull()
		expect(SFC.slice(sfc.block?.tagStart, sfc.block?.tagEnd)).toStartWith(
			'<router lang="ts">'
		)
		expect(SFC.slice(sfc.block?.tagStart, sfc.block?.tagEnd)).toEndWith(
			'</router>'
		)
	})

	test('returns no block when there is none', () => {
		expect(parseRouteSfc('<template><p /></template>').block).toBeNull()
	})

	test('rejects a block without lang="ts"', () => {
		expect(() =>
			parseRouteSfc('<router>export default 1</router>')
		).toThrow(RouteSfcError)
	})

	test('rejects two blocks', () => {
		expect(() =>
			parseRouteSfc('<router lang="ts">a</router><router lang="ts">b</router>')
		).toThrow(RouteSfcError)
	})
})

describe('rewriteRouteSfc', () => {
	test('replaces the block with a script shim and keeps the line count', () => {
		const out = rewriteRouteSfc(SFC, {
			importSpecifier: './x.vue.tsr-router.ts'
		})
		expect(out).not.toBeNull()
		expect(countLines(out as string)).toBe(countLines(SFC))
		expect(out).toContain(
			'<script lang="ts">import { Route } from "./x.vue.tsr-router.ts"; export { Route };</script>'
		)
		expect(out).not.toContain('<router')
		expect(out).not.toContain('createFileRoute')
		// The template and setup block keep their original line numbers.
		const lines = (out as string).split('\n')
		expect(lines[1]).toBe('\t<h1>{{ title }}</h1>')
		expect(lines[5]).toBe('const title = Route.useLoaderData()')
	})

	test('injects into an existing plain <script> instead of adding one', () => {
		const source = `<script lang="ts">
const shared = 1
</script>

<router lang="ts">
export default createFileRoute('/x')({})
</router>
`
		const out = rewriteRouteSfc(source, {
			importSpecifier: './x.vue.tsr-router.ts'
		})
		expect(countLines(out as string)).toBe(countLines(source))
		expect(out?.match(/<script/g)).toHaveLength(1)
		expect(out).toContain('import { Route } from "./x.vue.tsr-router.ts"')
		expect(out).toContain('const shared = 1')
		expect(out).not.toContain('createFileRoute')
	})

	test('gives a template-only route a default export', () => {
		const source = `<template>
	<h1>hi</h1>
</template>

<router lang="ts">
export default createFileRoute('/x')({})
</router>
`
		const out = rewriteRouteSfc(source, {
			importSpecifier: './x.vue.tsr-router.ts'
		}) as string
		expect(countLines(out)).toBe(countLines(source))
		expect(out).toContain('export default {};')
	})

	test('leaves the default export to <script setup> when there is one', () => {
		const out = rewriteRouteSfc(SFC, {
			importSpecifier: './x.vue.tsr-router.ts'
		}) as string
		expect(out).not.toContain('export default {}')
	})

	test('returns null for an SFC without a block', () => {
		expect(
			rewriteRouteSfc('<template><p /></template>', { importSpecifier: 'x' })
		).toBeNull()
	})
})

describe('buildRouterModule', () => {
	test('pads the block so its lines match the .vue file', () => {
		const out = buildRouterModule(SFC, {
			filename: 'x.vue',
			componentSpecifier: './x.vue',
			routerPackage: '@tanstack/vue-router'
		}) as string
		const lines = out.split('\n')
		// `<router lang="ts">` is on line 9 of SFC, so the import is on line 10.
		expect(lines[9]).toBe(
			"import { createFileRoute } from '@tanstack/vue-router'"
		)
		expect(out).toContain('export const Route = createFileRoute')
		expect(out).not.toContain('export default createFileRoute')
		expect(out).toContain('lazyRouteComponent as __tsrLazyRouteComponent')
		expect(out).toContain('import("./x.vue")')
	})

	test('omits the component wiring when the SFC renders nothing', () => {
		const out = buildRouterModule(
			`<router lang="ts">\nexport default createFileRoute('/x')({})\n</router>\n`,
			{
				filename: 'x.vue',
				componentSpecifier: './x.vue',
				routerPackage: '@tanstack/vue-router'
			}
		) as string
		expect(out).not.toContain('lazyRouteComponent')
	})
})

describe('checkRouterBlock', () => {
	test('accepts a matching route id', () => {
		expect(
			checkRouterBlock(
				"export default createFileRoute('/posts/$postId')({})",
				'/posts/$postId'
			)
		).toEqual({ ok: true, routeId: '/posts/$postId' })
	})

	test('reports a stale route id with the actual value', () => {
		const result = checkRouterBlock(
			"export default createFileRoute('/old')({})",
			'/new'
		)
		expect(result.ok).toBe(false)
		expect(result).toMatchObject({ actualRouteId: '/old' })
	})

	test('accepts the root route without a path', () => {
		expect(
			checkRouterBlock(
				'export default createRootRouteWithContext<Ctx>()({})',
				undefined
			)
		).toEqual({ ok: true, routeId: null })
	})

	test('rejects a named Route export', () => {
		expect(
			checkRouterBlock(
				"export const Route = createFileRoute('/x')({})",
				'/x'
			).ok
		).toBe(false)
	})

	test('rejects a block that exports nothing', () => {
		expect(checkRouterBlock('const Route = 1', '/x').ok).toBe(false)
	})
})

describe('replaceRouteId', () => {
	test('rewrites the id in place', () => {
		const source = SFC
		const block = parseRouteSfc(source).block
		const out = replaceRouteId(source, block!, '/posts/$slug') as string
		expect(out).toContain("createFileRoute('/posts/$slug')")
		expect(countLines(out)).toBe(countLines(source))
	})
})
