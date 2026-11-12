#!/usr/bin/env node
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { getConfig } from '@tanstack/router-plugin'
import { routerBlockGeneratorPlugin } from './generator-plugin'
import { DEFAULT_BLOCK_TYPE } from './sfc'

const USAGE = `Usage: tanstack-router-sfc generate [--root <dir>] [--block-type <name>] [--check]

Writes the route tree the Vite plugin writes, with options from
<root>/tsr.config.json. Exits 1 on a generator error.

  --root        the Vite root (default: the current directory)
  --block-type  the route block's name, as the plugin's blockType (default: router)
  --check       exit 1 if the route tree on disk was out of date (it is rewritten)
`

type Generator = { run(): Promise<void> }
type GeneratorClass = new (options: {
	config: ReturnType<typeof getConfig>
	root: string
}) => Generator

/**
 * The generator the installed `@tanstack/router-plugin` uses, so this writes
 * byte for byte what the Vite plugin writes.
 */
async function loadGenerator(): Promise<GeneratorClass> {
	const fromPlugin = createRequire(
		createRequire(import.meta.url).resolve('@tanstack/router-plugin')
	)
	const generator = await import(
		pathToFileURL(fromPlugin.resolve('@tanstack/router-generator')).href
	)
	return generator.Generator ?? generator.default.Generator
}

async function main(argv: Array<string>): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			root: { type: 'string', default: process.cwd() },
			'block-type': { type: 'string', default: DEFAULT_BLOCK_TYPE },
			check: { type: 'boolean', default: false },
			help: { type: 'boolean', default: false }
		}
	})
	if (values.help || positionals[0] !== 'generate') {
		process.stdout.write(USAGE)
		return values.help ? 0 : 1
	}

	const root = path.resolve(values.root)
	const base = getConfig({}, root)
	const config = getConfig(
		{
			target: 'vue',
			addExtensions: true,
			plugins: [
				...(base.plugins ?? []),
				routerBlockGeneratorPlugin({
					blockType: values['block-type'],
					routeFileIgnorePrefix: base.routeFileIgnorePrefix
				}) as never
			]
		},
		root
	)
	const treePath = path.resolve(root, config.generatedRouteTree)
	const read = () =>
		fs.existsSync(treePath) ? fs.readFileSync(treePath, 'utf-8') : null

	const before = read()
	const Generator = await loadGenerator()
	await new Generator({ config, root }).run()
	const after = read()

	if (values.check && before !== after) {
		process.stderr.write(
			`${path.relative(process.cwd(), treePath)} was out of date and has been regenerated. Commit it.\n`
		)
		return 1
	}
	return 0
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error: unknown) => {
		process.stderr.write(
			`tanstack-router-sfc: ${error instanceof Error ? error.message : String(error)}\n`
		)
		process.exit(1)
	}
)
