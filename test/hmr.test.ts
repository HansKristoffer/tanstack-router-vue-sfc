import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import { createServer, type HotPayload, type ViteDevServer } from 'vite'
import { tanstackRouterSfc } from '../src/vite'
import { copyFixture, removeFixture } from './fixture-copy'

/**
 * Dev-server guard for `handleHotUpdate`: a template edit must stay an HMR
 * update, a `<router>` edit must force a full reload (the router is built
 * once), and a block that stops parsing must reload too so the error shows.
 */

let root: string
let server: ViteDevServer
let file: string
const sent: Array<HotPayload> = []

function edit(from: string, to: string): void {
	const source = fs.readFileSync(file, 'utf-8')
	expect(source).toContain(from)
	fs.writeFileSync(file, source.replace(from, to))
}

async function change(): Promise<Array<string>> {
	sent.length = 0
	server.watcher.emit('change', file)
	await new Promise((resolve) => setTimeout(resolve, 300))
	return sent.map((payload) => payload.type)
}

beforeAll(async () => {
	root = copyFixture()
	file = path.join(root, 'src/routes/index.vue')
	server = await createServer({
		root,
		logLevel: 'silent',
		server: { ws: false, watch: null },
		plugins: [...tanstackRouterSfc(), vue()]
	})
	await server.listen(0)

	const hot = server.environments.client.hot
	const send = hot.send.bind(hot)
	hot.send = ((payload: HotPayload) => {
		sent.push(payload)
		send(payload)
	}) as typeof hot.send

	await server.transformRequest('/src/routeTree.gen.ts')
	await server.transformRequest('/src/routes/index.vue')
}, 60_000)

afterAll(async () => {
	await server?.close()
	removeFixture(root)
})

describe('handleHotUpdate', () => {
	test('a template edit is a plain HMR update', async () => {
		edit('{{ data }}', '{{ data }}!')
		const types = await change()
		expect(types).toContain('update')
		expect(types).not.toContain('full-reload')
	})

	test('a <router> edit forces a full reload and re-serves the block', async () => {
		edit("'FIXTURE_INDEX_LOADER'", "'CHANGED_LOADER'")
		expect(await change()).toContain('full-reload')
		const block = await server.transformRequest(
			'/src/routes/index.vue.tsr-router.ts'
		)
		expect(block?.code).toContain('CHANGED_LOADER')
	})

	test('a block that no longer parses forces a full reload', async () => {
		// The official generator plugin logs the same parse error; keep it out
		// of the test output.
		const error = spyOn(console, 'error').mockImplementation(() => {})
		try {
			edit('<router lang="ts">', '<router>')
			expect(await change()).toContain('full-reload')
		} finally {
			error.mockRestore()
		}
	})
})
