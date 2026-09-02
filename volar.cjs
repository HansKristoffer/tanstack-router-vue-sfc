/**
 * `@vue/language-core` plugin: makes a route SFC's `<router lang="ts">` block
 * part of the file's TypeScript.
 *
 * The block's code is spliced into the SFC's generated `script_ts` virtual
 * file right after the `<script setup>` import section - i.e. at module scope,
 * before the setup closure. That gives, in both `vue-tsc`/golar and the VS Code
 * Vue extension:
 *   - diagnostics inside the block, mapped to the real `.vue` lines
 *   - `Route` in scope inside `<script setup>` (not in `<template>`, matching
 *     what a plain `<script>` block does at runtime)
 *   - a typed `Route` export for `routeTree.gen.ts` to import
 *
 * CommonJS on purpose: both hosts load plugins with `require`.
 *
 * Register it in tsconfig.json:
 *   "vueCompilerOptions": { "plugins": ["@lullu/tanstack-router-sfc/volar"] }
 */

const CODE_FEATURES = {
	verification: true,
	completion: true,
	semantic: true,
	navigation: true,
	structure: true,
	format: false
}

const SCRIPT_CODE_ID = /^script_(ts|js|tsx|jsx)$/

/** @type {import('@vue/language-core').VueLanguagePlugin} */
const plugin = (ctx) => {
	const blockType = ctx?.config?.blockType ?? 'router'

	return {
		version: 2.2,
		name: 'tanstack-router-sfc',
		// After the built-in codegen plugins, so `script_ts` already has content.
		order: 1,
		resolveEmbeddedCode(_fileName, ir, embeddedCode) {
			if (!SCRIPT_CODE_ID.test(embeddedCode.id)) return

			const block = ir.customBlocks.find((b) => b.type === blockType)
			if (!block) return

			// `generateScriptSetupImports` emits the setup block's import section
			// as a single segment tagged (scriptSetup, 0). Everything after it is
			// inside the setup closure, so the block goes right behind it.
			let at = embeddedCode.content.findIndex(
				(segment) =>
					Array.isArray(segment) &&
					segment[1] === 'scriptSetup' &&
					segment[2] === 0
			)
			at = at === -1 ? 1 : at + 1

			embeddedCode.content.splice(
				at,
				0,
				'\n',
				[block.content, block.name, 0, CODE_FEATURES],
				'\n'
			)
		}
	}
}

module.exports = plugin
