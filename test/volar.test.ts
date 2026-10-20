import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { tanstackRouterSfc } from '../src/vite'
import { copyFixture, removeFixture } from './fixture-copy'

/**
 * Runs `vue-tsc` over the fixture with `volar.cjs` registered. One route
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

let root: string
let errors: Array<string>

beforeAll(async () => {
	root = copyFixture()
	fs.writeFileSync(path.join(root, 'src/routes/typo.vue'), TYPO_ROUTE)
	fs.writeFileSync(path.join(root, 'src/routes/shared.vue'), SHARED_ROUTE)
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

	// vue-tsc patches `tsc` at require time, which Bun does not honour - run
	// it under Node, which the engines field already requires.
	const result = spawnSync(
		'node',
		[
			path.join(import.meta.dir, '..', 'node_modules/vue-tsc/bin/vue-tsc.js'),
			'--noEmit',
			'--pretty',
			'false',
			'-p',
			path.join(root, 'tsconfig.json')
		],
		{ cwd: root, encoding: 'utf-8' }
	)
	errors = `${result.stdout}${result.stderr}`
		.split('\n')
		.filter((line) => line.includes('error TS'))
}, 60_000)

afterAll(() => removeFixture(root))

describe('volar plugin', () => {
	test('typechecks the block and exposes a typed Route to <script setup>', () => {
		expect(errors).toHaveLength(2)
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
})
