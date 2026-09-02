import { parse } from 'vue/compiler-sfc'

/**
 * Suffix of the virtual module that carries a route SFC's `<router>` block.
 *
 * It deliberately does NOT end in `.vue` (or `@vitejs/plugin-vue` would try to
 * compile the block as a whole SFC) and it DOES end in `.ts` (so Vite's esbuild
 * pass transpiles it as TypeScript).
 */
export const ROUTER_MODULE_SUFFIX = '.tsr-router.ts'

export const DEFAULT_BLOCK_TYPE = 'router'

export type RouterBlock = {
	content: string
	lang: string | undefined
	/** 1-based line the block *content* starts on. */
	startLine: number
	/** Offset of `<router`. */
	tagStart: number
	/** Offset just past `</router>`. */
	tagEnd: number
}

export type RouteSfc = {
	block: RouterBlock | null
	hasTemplate: boolean
	hasScriptSetup: boolean
	/** Content start offset of a plain (non-setup) `<script>`, if any. */
	plainScriptContentStart: number | null
}

export class RouteSfcError extends Error {}

function countNewlines(value: string): number {
	let count = 0
	for (let i = 0; i < value.length; i++) if (value[i] === '\n') count++
	return count
}

/** Parses an SFC and locates its `<router>` block (including the tag bounds). */
export function parseRouteSfc(
	source: string,
	options: { filename?: string; blockType?: string } = {}
): RouteSfc {
	const blockType = options.blockType ?? DEFAULT_BLOCK_TYPE
	const { descriptor } = parse(source, {
		filename: options.filename ?? 'route.vue'
	})

	const blocks = descriptor.customBlocks.filter((b) => b.type === blockType)
	if (blocks.length > 1) {
		throw new RouteSfcError(
			`Expected at most one <${blockType}> block, found ${blocks.length}.`
		)
	}

	const raw = blocks[0]
	let block: RouterBlock | null = null
	if (raw) {
		if (raw.src) {
			throw new RouteSfcError(
				`A <${blockType}> block cannot use the "src" attribute.`
			)
		}
		if (raw.lang !== 'ts') {
			throw new RouteSfcError(
				`A <${blockType}> block must be TypeScript. Write <${blockType} lang="ts">.`
			)
		}
		const contentStart = raw.loc.start.offset
		const contentEnd = raw.loc.end.offset
		const tagStart = source.lastIndexOf(`<${blockType}`, contentStart)
		const closeStart = source.indexOf(`</${blockType}`, contentEnd)
		const closeEnd = closeStart === -1 ? -1 : source.indexOf('>', closeStart)
		if (tagStart === -1 || closeEnd === -1) {
			throw new RouteSfcError(`Could not locate the <${blockType}> block tags.`)
		}
		block = {
			content: raw.content,
			lang: raw.lang,
			startLine: raw.loc.start.line,
			tagStart,
			tagEnd: closeEnd + 1
		}
	}

	return {
		block,
		hasTemplate: descriptor.template !== null,
		hasScriptSetup: descriptor.scriptSetup !== null,
		plainScriptContentStart: descriptor.script
			? descriptor.script.loc.start.offset
			: null
	}
}

/**
 * Replaces the `<router>` block with a `<script>` shim that re-exports `Route`
 * from the block's virtual module.
 *
 * The rewrite preserves the file's line count so `<template>` and
 * `<script setup>` diagnostics and source maps keep pointing at the right
 * lines. Returns `null` when the SFC has no `<router>` block.
 */
export function rewriteRouteSfc(
	source: string,
	options: { importSpecifier: string; filename?: string; blockType?: string }
): string | null {
	const sfc = parseRouteSfc(source, options)
	if (!sfc.block) return null

	const { tagStart, tagEnd } = sfc.block
	const padding = '\n'.repeat(countNewlines(source.slice(tagStart, tagEnd)))
	const importStatement = `import { Route } from ${JSON.stringify(options.importSpecifier)}; export { Route };`

	// A plain <script> already occupies the SFC's module scope, so the import
	// is prepended into it (on its first line, to keep line numbers stable)
	// and the block is replaced by whitespace.
	if (sfc.plainScriptContentStart !== null) {
		const at = sfc.plainScriptContentStart
		const before = source.slice(0, tagStart) + padding + source.slice(tagEnd)
		// The block always follows or precedes the script; splice into whichever
		// offset is still valid after removing the block.
		const shift = at > tagStart ? padding.length - (tagEnd - tagStart) : 0
		const insertAt = at + shift
		return `${before.slice(0, insertAt)}${importStatement}${before.slice(insertAt)}`
	}

	// Without a `<script setup>` the shim becomes the SFC's only script, and a
	// script block that exports no default leaves the component undefined.
	const defaultExport = sfc.hasScriptSetup ? '' : ' export default {};'
	const shim = `<script lang="ts">${importStatement}${defaultExport}</script>`
	return source.slice(0, tagStart) + shim + padding + source.slice(tagEnd)
}

/**
 * Builds the virtual module for a route SFC's `<router>` block: the block's
 * TypeScript, padded so its line numbers match the `.vue` file, plus the
 * lazy `component` wiring when the SFC actually renders something.
 */
export function buildRouterModule(
	source: string,
	options: {
		filename: string
		/** Import specifier the module uses to lazily load its own SFC. */
		componentSpecifier: string
		routerPackage: string
		blockType?: string
	}
): string | null {
	const sfc = parseRouteSfc(source, options)
	if (!sfc.block) return null

	const lines: Array<string> = [
		'\n'.repeat(sfc.block.startLine - 1) + sfc.block.content
	]

	if (sfc.hasTemplate || sfc.hasScriptSetup) {
		lines.push(
			`\nimport { lazyRouteComponent as __tsrLazyRouteComponent } from ${JSON.stringify(options.routerPackage)}`,
			`Route.update({ component: __tsrLazyRouteComponent(() => import(${JSON.stringify(options.componentSpecifier)}), 'default') })`
		)
	}

	return `${lines.join('\n')}\n`
}

const ROUTE_EXPORT_REGEX = /export\s+(?:const|let|var)\s+Route\b/
const CREATE_FILE_ROUTE_REGEX =
	/createFileRoute\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)/
const CREATE_ROOT_ROUTE_REGEX = /createRootRoute(?:WithContext)?\s*[(<]/

export type RouterBlockCheck =
	| { ok: true; routeId: string | null }
	| { ok: false; message: string; actualRouteId?: string }

/**
 * Validates a `<router>` block: it must export `Route` from exactly one
 * `createFileRoute('<path>')` (or `createRootRoute*` for `__root`), and the
 * path must be the one the file's location implies.
 */
export function checkRouterBlock(
	blockContent: string,
	expectedRouteId: string | undefined
): RouterBlockCheck {
	if (!ROUTE_EXPORT_REGEX.test(blockContent)) {
		return {
			ok: false,
			message: `the block must contain \`export const Route = ...\`.`
		}
	}

	if (CREATE_ROOT_ROUTE_REGEX.test(blockContent)) {
		return { ok: true, routeId: null }
	}

	const match = CREATE_FILE_ROUTE_REGEX.exec(blockContent)
	if (!match) {
		return {
			ok: false,
			message: `the block must call \`createFileRoute('<path>')\` with a string literal path.`
		}
	}

	const actualRouteId = match[2] as string
	if (expectedRouteId !== undefined && actualRouteId !== expectedRouteId) {
		return {
			ok: false,
			actualRouteId,
			message: `\`createFileRoute('${actualRouteId}')\` does not match this file's route path '${expectedRouteId}'.`
		}
	}

	return { ok: true, routeId: actualRouteId }
}

/** Rewrites the route id inside a `<router>` block (used to fix renames). */
export function replaceRouteId(
	source: string,
	block: RouterBlock,
	routeId: string
): string | null {
	const match = CREATE_FILE_ROUTE_REGEX.exec(block.content)
	if (!match) return null
	const quote = match[1] as string

	const newContent =
		block.content.slice(0, match.index) +
		match[0].replace(
			`${quote}${match[2] as string}${quote}`,
			`${quote}${routeId}${quote}`
		) +
		block.content.slice(match.index + match[0].length)

	const contentStart = source.indexOf(block.content, block.tagStart)
	if (contentStart === -1) return null
	return (
		source.slice(0, contentStart) +
		newContent +
		source.slice(contentStart + block.content.length)
	)
}
