import fs from 'node:fs'
import path from 'node:path'
import type { Config } from '@tanstack/router-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import type { Plugin } from 'vite'
import { routerBlockGeneratorPlugin } from './generator-plugin'
import {
	buildRouterModule,
	DEFAULT_BLOCK_TYPE,
	parseRouteSfc,
	rewriteRouteSfc,
	ROUTER_MODULE_SUFFIX,
	RouteSfcError
} from './sfc'

/**
 * Everything `tanstackRouter` accepts, minus the two options this plugin owns:
 * `target` is always `'vue'`, and `addExtensions` is what makes the block's
 * `Route` resolvable by TypeScript.
 */
export type TanstackRouterSfcOptions = Omit<
	Partial<Config>,
	'target' | 'addExtensions'
> & {
	/** Name of the custom SFC block holding the route definition. */
	blockType?: string
}

export { ROUTER_MODULE_SUFFIX }

const ROUTER_PACKAGE = '@tanstack/vue-router'

function normalize(id: string): string {
	return id.replace(/\\/g, '/')
}

function stripQuery(id: string): string {
	const index = id.indexOf('?')
	return index === -1 ? id : id.slice(0, index)
}

function toArray<T>(value: T | Array<T>): Array<T> {
	return Array.isArray(value) ? value : [value]
}

/**
 * TanStack Router for Vue with single-file routes.
 *
 * A route is one `.vue` file whose `<router lang="ts">` block exports the
 * `Route`; the SFC itself is the route's component. Drop-in replacement for
 * `tanstackRouter({ target: 'vue' })` - route generation, watching and code
 * splitting stay with the official plugin, which this composes - and the
 * `x.ts` + `x.component.vue` convention keeps working alongside it.
 */
export function tanstackRouterSfc(
	options: TanstackRouterSfcOptions = {}
): Array<Plugin> {
	const { blockType = DEFAULT_BLOCK_TYPE, ...routerOptions } = options

	let routesDirectory = ''
	let generatedRouteTreePath = ''

	/** Last `<router>` block content per file, for HMR change detection. */
	const blockCache = new Map<string, string>()

	const isRouteFile = (file: string): boolean => {
		const normalized = normalize(file)
		return (
			routesDirectory !== '' &&
			normalized.startsWith(`${routesDirectory}/`) &&
			normalized.endsWith('.vue')
		)
	}

	const importSpecifierFor = (file: string) =>
		`./${path.basename(file)}${ROUTER_MODULE_SUFFIX}`

	const readBlockContent = (file: string): string | null => {
		try {
			const parsed = parseRouteSfc(fs.readFileSync(file, 'utf-8'), {
				filename: file,
				blockType
			})
			return parsed.block?.content ?? null
		} catch {
			return null
		}
	}

	/**
	 * `addExtensions` makes the generated tree import `./routes/x.vue`, which is
	 * what TypeScript needs to see the `Route` the block exports. At runtime that
	 * import must resolve to the `<router>` block alone - importing the SFC
	 * would pull every page into the entry chunk.
	 */
	const routeTreeImports: Plugin = {
		name: 'tanstack-router-sfc:route-tree',
		enforce: 'pre',
		configResolved(config) {
			// Module ids arrive as real paths, so a symlinked root (macOS
			// `/var` -> `/private/var`, pnpm-style links) would never match.
			const resolve = (value: string) => {
				const resolved = path.resolve(config.root, value)
				try {
					return normalize(fs.realpathSync(resolved))
				} catch {
					return normalize(resolved)
				}
			}
			routesDirectory = resolve(routerOptions.routesDirectory ?? './src/routes')
			generatedRouteTreePath = resolve(
				routerOptions.generatedRouteTree ?? './src/routeTree.gen.ts'
			)
		},
		transform: {
			filter: { id: /routeTree\.gen\.(ts|js)$/ },
			handler(code, id) {
				if (normalize(stripQuery(id)) !== generatedRouteTreePath) return null
				const next = code.replace(
					/from '([^']*\.vue)'/g,
					(_match, source: string) => `from '${source}${ROUTER_MODULE_SUFFIX}'`
				)
				if (next === code) return null
				return { code: next, map: { mappings: '' } }
			}
		}
	}

	/**
	 * Rewrites a route SFC before `@vitejs/plugin-vue` parses it: the
	 * `<router>` block becomes a `<script>` shim re-exporting `Route` from the
	 * block's own module, so `Route` is in scope in `<script setup>` and is a
	 * named export of the `.vue` module.
	 */
	const routeSfc: Plugin = {
		name: 'tanstack-router-sfc:sfc',
		enforce: 'pre',
		transform: {
			filter: { id: /\.vue$/ },
			handler(code, id) {
				const file = normalize(stripQuery(id))
				if (id.includes('?') || !isRouteFile(file)) return null
				try {
					const next = rewriteRouteSfc(code, {
						filename: file,
						blockType,
						importSpecifier: importSpecifierFor(file)
					})
					if (next === null) return null
					return { code: next, map: { mappings: '' } }
				} catch (error) {
					this.error(
						error instanceof RouteSfcError
							? `${file}: ${error.message}`
							: String(error)
					)
				}
			}
		},
		handleHotUpdate(ctx) {
			const file = normalize(ctx.file)
			if (!isRouteFile(file)) return

			// plugin-vue diffs the descriptor it parsed last time, which is the
			// rewritten one - hand it the rewritten source here too, or every
			// edit looks like a whole-script change and forces a reload.
			const read = ctx.read
			ctx.read = async () => {
				const source = await read()
				try {
					return (
						rewriteRouteSfc(source, {
							filename: file,
							blockType,
							importSpecifier: importSpecifierFor(file)
						}) ?? source
					)
				} catch {
					return source
				}
			}

			// The shim is a constant, so a `<router>` edit is invisible to
			// plugin-vue: its module would keep serving the stale route
			// definition. Drop it from the transform cache on every edit.
			const mod = ctx.server.moduleGraph.getModuleById(
				`${file}${ROUTER_MODULE_SUFFIX}`
			)
			if (!mod) return

			ctx.server.moduleGraph.invalidateModule(mod)

			const previous = blockCache.get(file)
			const current = readBlockContent(file)
			if (current !== null) blockCache.set(file, current)
			if (previous === undefined || previous === current) return

			// A changed route definition has to be re-evaluated by the router,
			// which is built once at startup. Propagating the invalidation stops
			// at the first component that accepts HMR, so ask for a reload
			// outright - the same thing editing a `.ts` route file does.
			const hot = ctx.server.hot ?? ctx.server.ws
			hot.send({ type: 'full-reload', path: '*' })
			return []
		}
	}

	/** Serves `<file>.vue.tsr-router.ts` - the route definition on its own. */
	const routerBlockModule: Plugin = {
		name: 'tanstack-router-sfc:router-block',
		resolveId(id, importer) {
			if (!id.endsWith(ROUTER_MODULE_SUFFIX)) return null
			if (path.isAbsolute(id)) return normalize(id)
			if (id.startsWith('.') && importer) {
				return normalize(path.resolve(path.dirname(stripQuery(importer)), id))
			}
			return null
		},
		load(id) {
			if (!id.endsWith(ROUTER_MODULE_SUFFIX)) return null
			const file = normalize(id).slice(0, -ROUTER_MODULE_SUFFIX.length)
			if (!isRouteFile(file)) return null

			this.addWatchFile(file)
			const source = fs.readFileSync(file, 'utf-8')

			let code: string | null
			try {
				code = buildRouterModule(source, {
					filename: file,
					blockType,
					routerPackage: ROUTER_PACKAGE,
					componentSpecifier: `./${path.basename(file)}`
				})
			} catch (error) {
				return this.error(
					error instanceof RouteSfcError
						? `${file}: ${error.message}`
						: String(error)
				)
			}

			// The generator plugin reports this too, but it only sees files it
			// re-processed, and the official generator plugin logs its errors
			// instead of failing. This is the backstop that stops the build.
			if (code === null) {
				return this.error(
					`${file} is imported as a route but has no <${blockType} lang="ts"> block.`
				)
			}

			blockCache.set(file, readBlockContent(file) ?? '')
			return { code, map: null }
		}
	}

	return [
		// Generation, file watching, formatting, route HMR and code splitting
		// all stay with the official plugin.
		...toArray(
			tanstackRouter({
				...routerOptions,
				target: 'vue',
				// Keeps `.vue` on the tree's eager imports so TypeScript resolves
				// the block's `Route`. Pairs keep their `.ts`, which is fine:
				// `@vue/tsconfig` allows importing TS extensions and the generated
				// tree is `@ts-nocheck` anyway.
				addExtensions: true,
				plugins: [
					...(routerOptions.plugins ?? []),
					routerBlockGeneratorPlugin({
						blockType,
						routeFileIgnorePrefix: routerOptions.routeFileIgnorePrefix ?? '-'
					})
				]
			}) as Plugin | Array<Plugin>
		),
		routeTreeImports,
		routeSfc,
		routerBlockModule
	]
}

export default tanstackRouterSfc
