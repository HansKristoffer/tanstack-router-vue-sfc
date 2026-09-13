import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { routerBlockGeneratorPlugin } from './generator-plugin'

let dir: string
const plugin = routerBlockGeneratorPlugin({
	blockType: 'router',
	routeFileIgnorePrefix: '-'
})

function write(name: string, content: string): string {
	const fullPath = path.join(dir, name)
	fs.writeFileSync(fullPath, content)
	return fullPath
}

function node(fullPath: string, routePath?: string, type = 'static') {
	return {
		node: {
			fullPath,
			filePath: path.basename(fullPath),
			routePath,
			_fsRouteType: type
		}
	}
}

const block = (routeId: string) =>
	`<template><p /></template>\n<router lang="ts">\nimport { createFileRoute } from '@tanstack/vue-router'\n\nexport default createFileRoute('${routeId}')({})\n</router>\n`

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsr-sfc-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('afterTransform', () => {
	test('accepts a block whose id matches the file', () => {
		const file = write('about.vue', block('/about'))
		expect(() => plugin.afterTransform?.(node(file, '/about'))).not.toThrow()
		expect(fs.readFileSync(file, 'utf-8')).toBe(block('/about'))
	})

	test('rewrites a stale id in place after a rename', () => {
		const file = write('about.vue', block('/old'))
		plugin.afterTransform?.(node(file, '/about'))
		expect(fs.readFileSync(file, 'utf-8')).toBe(block('/about'))
	})

	test('rejects a route file without a block', () => {
		const file = write('about.vue', '<template><p /></template>\n')
		expect(() => plugin.afterTransform?.(node(file, '/about'))).toThrow(
			/no <router lang="ts"> block.*"-" prefix/s
		)
	})

	test('rejects a block that does not default-export a route', () => {
		const file = write(
			'about.vue',
			`<router lang="ts">\nexport const Route = createFileRoute('/about')({})\n</router>\n`
		)
		expect(() => plugin.afterTransform?.(node(file, '/about'))).toThrow(
			/export default createFileRoute/
		)
	})

	test('ignores piece files and non-vue files', () => {
		const piece = write('about.component.vue', '<template><p /></template>\n')
		const ts = write('about.ts', 'export const Route = 1\n')
		expect(() =>
			plugin.afterTransform?.(node(piece, '/about', 'component'))
		).not.toThrow()
		expect(() => plugin.afterTransform?.(node(ts, '/about'))).not.toThrow()
	})
})

describe('scaffolding', () => {
	test('fills an empty route file once the tree has been written', () => {
		const file = write('posts.vue', '')
		plugin.afterTransform?.(node(file, '/posts'))
		expect(fs.readFileSync(file, 'utf-8')).toBe('')
		plugin.onRouteTreeChanged?.({})
		const out = fs.readFileSync(file, 'utf-8')
		expect(out).toContain("export default createFileRoute('/posts')({})")
		expect(out).toContain('<router lang="ts">')
		expect(out).toContain('<template>')
		// And it now passes its own check.
		expect(() => plugin.afterTransform?.(node(file, '/posts'))).not.toThrow()
	})

	test('scaffolds the root route with createRootRoute and an Outlet', () => {
		const file = write('__root.vue', '')
		plugin.afterTransform?.(node(file, undefined, '__root'))
		plugin.onRouteTreeChanged?.({})
		const out = fs.readFileSync(file, 'utf-8')
		expect(out).toContain('export default createRootRoute({})')
		expect(out).toContain('<Outlet />')
		expect(() =>
			plugin.afterTransform?.(node(file, undefined, '__root'))
		).not.toThrow()
	})
})
