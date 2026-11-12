import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { tanstackRouterSfc } from '../src/vite'
import { copyFixture, removeFixture } from './fixture-copy'

/**
 * Runs `vue-tsc` and golar over the fixture with `volar.cjs` registered. One route
 * carries two deliberate type errors - one inside the `<router>` block, one
 * in `<script setup>` that only exists if `Route` is typed from the block -
 * and those must be the *only* errors, reported on the right `.vue` lines.
 */

const TYPO_ROUTE = `<template><p>{{ n }}</p></template>

<script setup lang="ts">
const n: string = Route.useLoaderData()
</script>

<router lang="ts">
import { createFileRoute } from '@tanstack/vue-router'

export default createFileRoute('/typo')({
	loader: (): number => 'not a number'
})
</router>
`

// Before 1.0.2 the block shared <script setup>'s scope: the shared `ref`
// import and the two `label` consts were "Duplicate identifier" errors.
const SHARED_ROUTE = `<template><p>{{ label }}</p></template>

<script setup lang="ts">
import { ref } from 'vue'
import { createFileRoute } from '@tanstack/vue-router'
const label = ref(String(Route.useLoaderData().value))
</script>

<router lang="ts">
import { createFileRoute, redirect } from '@tanstack/vue-router'
import { ref } from 'vue'
import type { Ref } from 'vue'

const label: Ref<number> = ref(1)

export default createFileRoute('/shared')({
	beforeLoad: () => {
		if (label.value < 0) throw redirect({ to: '/' })
	},
	loader: () => label
})
</router>
`

// The block is its own module at runtime: `<script setup>`'s imports and
// top-level consts do not exist there, so using them must not typecheck.
const LEAK_ROUTE = `<template><p>{{ doubled }}</p></template>

<script setup lang="ts">
import { computed } from 'vue'
const limit = 1
const doubled = computed(() => limit * 2)
</script>

<router lang="ts">
import { createFileRoute } from '@tanstack/vue-router'

export default createFileRoute('/leak')({
	beforeLoad: () => {
		if (limit > 0) return
	},
	loader: () => computed(() => 1)
})
</router>
`

let root: string
let errors: Array<string>
let golarErrors: Array<string>

beforeAll(async () => {
	root = copyFixture()
	fs.writeFileSync(path.join(root, 'src/routes/typo.vue'), TYPO_ROUTE)
	fs.writeFileSync(path.join(root, 'src/routes/shared.vue'), SHARED_ROUTE)
	fs.writeFileSync(path.join(root, 'src/routes/leak.vue'), LEAK_ROUTE)
	// Generates routeTree.gen.ts, which main.ts imports.
	await build({
		root,
		logLevel: 'silent',
		plugins: [...tanstackRouterSfc(), vue()],
		build: { write: false }
	})

	fs.writeFileSync(
		path.join(root, 'tsconfig.json'),
		JSON.stringify({
			compilerOptions: {
				target: 'esnext',
				module: 'preserve',
				moduleResolution: 'bundler',
				lib: ['esnext', 'dom'],
				strict: true,
				// The plugin's generated shadows must not count as unused.
				noUnusedLocals: true,
				noEmit: true,
				skipLibCheck: true,
				allowImportingTsExtensions: true,
				types: []
			},
			vueCompilerOptions: {
				plugins: [path.join(import.meta.dir, '..', 'volar.cjs')]
			},
			include: ['src/**/*']
		})
	)

	errors = typecheck([
		path.join(import.meta.dir, '..', 'node_modules/vue-tsc/bin/vue-tsc.js'),
		'--noEmit',
		'--pretty',
		'false',
		'-p',
		path.join(root, 'tsconfig.json')
	])
	fs.writeFileSync(
		path.join(root, 'golar.config.ts'),
		`import { defineConfig } from 'golar/unstable'\nimport '@golar/vue'\nexport default defineConfig({ typecheck: { include: ['src/**/*.{ts,vue}'] } })\n`
	)
	// golar builds TypeScript nodes without `getStart` or `Identifier#text`,
	// so it runs the plugin's fallback paths.
	golarErrors = typecheck(
		[
			path.join(import.meta.dir, '..', 'node_modules/golar/dist/bin.js'),
			'typecheck'
		],
		// golar skips git-ignored files, and the fixture copy is one.
		{ GIT_DIR: path.join(root, 'no-git') }
	)
}, 60_000)

function typecheck(
	args: Array<string>,
	env?: Record<string, string>
): Array<string> {
	// vue-tsc patches `tsc` at require time, which Bun does not honour - run
	// it under Node, which the engines field already requires.
	const result = spawnSync('node', args, {
		cwd: root,
		encoding: 'utf-8',
		env: { ...process.env, ...env }
	})
	return `${result.stdout}${result.stderr}`
		.split('\n')
		.filter((line) => line.includes('error TS'))
}

afterAll(() => removeFixture(root))

describe('volar plugin', () => {
	test('typechecks the block and exposes a typed Route to <script setup>', () => {
		expect(errors.filter((e) => !e.includes('routes/leak.vue'))).toHaveLength(2)
		// `loader: (): number => 'not a number'` is on line 11.
		expect(errors.some((e) => e.includes('routes/typo.vue(11,'))).toBe(true)
		// `const n: string = Route.useLoaderData()` is on line 4; the loader
		// returns a number, which only the block can have told TypeScript.
		expect(
			errors.some(
				(e) => e.includes('routes/typo.vue(4,') && e.includes('Ref<number')
			)
		).toBe(true)
	})

	test('scopes the block apart from <script setup>', () => {
		expect(errors.filter((e) => e.includes('routes/shared.vue'))).toEqual([])
	})

	test('golar reports the same errors as vue-tsc', () => {
		expect(golarErrors).toEqual(errors)
	})

	test("rejects <script setup>'s names inside the block", () => {
		const leaks = errors.filter((e) => e.includes('routes/leak.vue'))
		// `limit > 0` on line 14, `computed(...)` on line 16.
		expect(leaks.map((e) => e.match(/leak\.vue\((\d+),/)?.[1])).toEqual([
			'14',
			'16'
		])
		// TS puts the type on the message's second line for a call.
		expect(leaks[0]).toContain('ImportThisInTheRouterBlock')
		expect(leaks[1]).toContain('not callable')
	})
})
