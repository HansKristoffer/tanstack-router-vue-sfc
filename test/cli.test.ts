import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'
import { tanstackRouterSfc } from '../src/vite'
import { copyFixture, removeFixture } from './fixture-copy'

let root: string
let tree: string

function generate(...args: Array<string>) {
	const result = spawnSync(
		'bun',
		[
			path.join(import.meta.dir, '../src/cli.ts'),
			'generate',
			'--root',
			root,
			...args
		],
		{ encoding: 'utf-8' }
	)
	return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

beforeAll(async () => {
	root = copyFixture()
	tree = path.join(root, 'src/routeTree.gen.ts')
	await build({
		root,
		logLevel: 'silent',
		plugins: [...tanstackRouterSfc(), vue()],
		build: { write: false }
	})
}, 60_000)

afterAll(() => removeFixture(root))

describe('tanstack-router-sfc generate', () => {
	test('writes the tree the Vite plugin writes', () => {
		expect(generate('--check')).toEqual({ code: 0, output: '' })
		fs.rmSync(tree)
		expect(generate().code).toBe(0)
		expect(fs.readFileSync(tree, 'utf-8')).toContain(
			"from './routes/about.vue'"
		)
	})

	test('--check fails when a route was added without regenerating', () => {
		fs.writeFileSync(
			path.join(root, 'src/routes/new.vue'),
			"<template><p /></template>\n\n<router lang=\"ts\">\nimport { createFileRoute } from '@tanstack/vue-router'\n\nexport default createFileRoute('/new')({})\n</router>\n"
		)
		const { code, output } = generate('--check')
		expect(code).toBe(1)
		expect(output).toContain('out of date')
		expect(fs.readFileSync(tree, 'utf-8')).toContain('/new')
		expect(generate('--check').code).toBe(0)
	})

	test('a route file without a block is an error', () => {
		const broken = path.join(root, 'src/routes/broken.vue')
		fs.writeFileSync(broken, '<template><p /></template>\n')
		try {
			const { code, output } = generate()
			expect(code).toBe(1)
			expect(output).toContain('has no <router lang="ts"> block')
		} finally {
			fs.rmSync(broken)
		}
	})
})
