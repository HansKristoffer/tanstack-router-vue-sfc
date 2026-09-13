import fs from 'node:fs'
import path from 'node:path'

const FIXTURE = path.join(import.meta.dir, 'fixture')

/**
 * Copies `test/fixture` to a scratch directory inside the package, so the
 * generated route tree never lands in the fixture. It has to sit inside the
 * package (not in $TMPDIR) or the fixture cannot resolve `vue` /
 * `@tanstack/vue-router` from node_modules.
 */
export function copyFixture(): string {
	const dir = fs.mkdtempSync(path.join(import.meta.dir, '..', '.test-build-'))
	fs.cpSync(FIXTURE, dir, { recursive: true })
	return dir
}

export function removeFixture(dir: string): void {
	if (dir) fs.rmSync(dir, { recursive: true, force: true })
}
