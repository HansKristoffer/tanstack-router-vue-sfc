import fs from 'node:fs'
import {
	checkRouterBlock,
	parseRouteSfc,
	replaceRouteId,
	RouteSfcError
} from './sfc'

/**
 * The parts of `@tanstack/router-generator`'s `GeneratorPlugin` this package
 * uses. Typed structurally so the package needs no dependency on the generator.
 */
export type RouteGeneratorPlugin = {
	name: string
	afterTransform?: (opts: {
		node: {
			fullPath: string
			filePath: string
			routePath?: string | undefined
			_fsRouteType: string
		}
	}) => void
	onRouteTreeChanged?: (opts: unknown) => void
}

/** Route node types that are *pieces* of another route rather than a route. */
const PIECE_FS_ROUTE_TYPES = new Set([
	'component',
	'errorComponent',
	'notFoundComponent',
	'pendingComponent',
	'loader',
	'lazy'
])

function quote(value: string): string {
	return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function scaffold(
	blockType: string,
	routePath: string,
	isRoot: boolean
): string {
	const definition = isRoot
		? 'export default createRootRoute({})'
		: `export default createFileRoute(${quote(routePath)})({})`
	const imported = isRoot ? 'Outlet, createRootRoute' : 'createFileRoute'
	const body = isRoot ? '\t<Outlet />' : `\t<div>Hello ${routePath}!</div>`

	return [
		'<template>',
		body,
		'</template>',
		'',
		...(isRoot
			? [
					'<script setup lang="ts">',
					"import { Outlet } from '@tanstack/vue-router'",
					'</script>',
					''
				]
			: []),
		`<${blockType} lang="ts">`,
		`import { ${imported} } from '@tanstack/vue-router'`,
		'',
		definition,
		`</${blockType}>`,
		''
	].join('\n')
}

/**
 * Generator plugin that owns the two things the stock generator cannot know
 * about a single-file route: that it must carry a `<router>` block, and that
 * the block's `createFileRoute('...')` id has to follow the file when it moves.
 * The generator skips its own id-rewriting transform for `.vue` files, so this
 * is the `.vue` equivalent of what it already does for `.ts` route files.
 *
 * It also replaces the scaffolding the generator writes into an empty `.vue`
 * route file. `customScaffolding` cannot do that: the generator runs every
 * template through prettier with `parser: 'typescript'`, which rejects an SFC.
 */
export function routerBlockGeneratorPlugin(options: {
	blockType: string
	routeFileIgnorePrefix: string
}): RouteGeneratorPlugin {
	const { blockType } = options

	/** Empty `.vue` route files seen this pass, to re-scaffold after the write. */
	const pendingScaffold = new Map<
		string,
		{ routePath: string; isRoot: boolean }
	>()

	return {
		name: 'tanstack-router-sfc',

		afterTransform({ node }) {
			if (!node.filePath.endsWith('.vue')) return
			if (PIECE_FS_ROUTE_TYPES.has(node._fsRouteType)) return

			let source: string
			try {
				source = fs.readFileSync(node.fullPath, 'utf-8')
			} catch {
				return
			}

			// An empty file is one the generator is about to scaffold; it writes
			// the route file *after* this hook, so there is nothing to check yet.
			if (source.trim() === '') {
				pendingScaffold.set(node.fullPath, {
					routePath: node.routePath ?? '/',
					isRoot: node._fsRouteType === '__root'
				})
				return
			}

			let parsed: ReturnType<typeof parseRouteSfc>
			try {
				parsed = parseRouteSfc(source, {
					filename: node.fullPath,
					blockType
				})
			} catch (error) {
				throw new Error(
					`${node.fullPath}: ${error instanceof RouteSfcError ? error.message : String(error)}`
				)
			}

			if (!parsed.block) {
				throw new Error(
					`${node.fullPath} is a route file but has no <${blockType} lang="ts"> block.\n` +
						`Add one that default-exports the route, or exclude the file with the "${options.routeFileIgnorePrefix}" prefix.`
				)
			}

			const expected = node.routePath
			const check = checkRouterBlock(parsed.block.content, expected)
			if (check.ok) return

			// A mismatched id means the file moved - fix it in place.
			if (check.actualRouteId !== undefined && expected !== undefined) {
				const fixed = replaceRouteId(source, parsed.block, expected)
				if (fixed !== null) {
					fs.writeFileSync(node.fullPath, fixed, 'utf-8')
					return
				}
			}

			throw new Error(
				`${node.fullPath}: <${blockType}> block is invalid - ${check.message}`
			)
		},

		// Runs after the generator has written its own scaffolding.
		onRouteTreeChanged() {
			for (const [fullPath, { routePath, isRoot }] of pendingScaffold) {
				try {
					fs.writeFileSync(
						fullPath,
						scaffold(blockType, routePath, isRoot),
						'utf-8'
					)
				} catch {
					// A file that vanished mid-generation is not worth failing over.
				}
			}
			pendingScaffold.clear()
		}
	}
}
