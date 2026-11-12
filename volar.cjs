/**
 * `@vue/language-core` plugin: makes a route SFC's `<router lang="ts">` block
 * part of the file's TypeScript.
 *
 * The block's code is spliced into the SFC's generated `script_ts` virtual
 * file right after the `<script setup>` import section, as:
 *
 *   <the block's imports, minus bindings <script> / <script setup> already import>
 *   { <the rest of the block, its `export default` bound as `var Route =`> }
 *   export { Route }
 *
 * That gives, in both `vue-tsc`/golar and the VS Code Vue extension:
 *   - diagnostics inside the block, mapped to the real `.vue` lines
 *   - `Route` in scope inside `<script setup>` (not in `<template>`, matching
 *     what a plain `<script>` block does at runtime)
 *   - a typed `Route` export for `routeTree.gen.ts` to import
 *
 * At runtime the block is a module of its own, so nothing but `Route` may
 * clash with `<script setup>`. language-core emits a non-generic setup body at
 * module root, which is why the rest of the block is wrapped in braces: its
 * declarations stay block-scoped while `var` lifts `Route` out. Imports cannot
 * move into braces, so an import both halves make is kept once instead.
 *
 * The braces do not stop the block from seeing `<script setup>`'s imports and
 * top-level declarations, which do not exist in the block's module at runtime
 * (a `ReferenceError` when the route loads). So the braces open by shadowing
 * each of those names with a value of type `ImportThisInTheRouterBlock`, and a
 * call, property access or typed use of one is a type error in the block.
 *
 * CommonJS on purpose: both hosts load plugins with `require`.
 *
 * Register it in tsconfig.json:
 *   "vueCompilerOptions": { "plugins": ["tanstack-router-sfc/volar"] }
 * or, with a custom block name (matching the Vite plugin's `blockType`):
 *   "vueCompilerOptions": {
 *     "plugins": [{ "name": "tanstack-router-sfc/volar", "blockType": "route" }]
 *   }
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

/**
 * @typedef {{ node: import('typescript').Node, local: string, imported: string, from: string, typeOnly: boolean }} Binding
 */

// Whitespace and comments, which is all the trivia a statement can lead with.
const TRIVIA = /(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/y

/**
 * Start of a node without its leading trivia. golar's TypeScript build creates
 * nodes without the prototype methods (`getStart`), so fall back to scanning.
 * @param {import('typescript').SourceFile} sourceFile
 * @param {import('typescript').Node} node
 */
function startOf(sourceFile, node) {
	if (typeof node.getStart === 'function') return node.getStart(sourceFile)
	TRIVIA.lastIndex = node.pos
	TRIVIA.exec(sourceFile.text)
	return TRIVIA.lastIndex
}

/**
 * Enum members as literals: vue-tsc hands plugins a `typescript` whose enums
 * are not reachable (`ScriptTarget is not defined`).
 * @param {typeof import('typescript')} ts
 * @param {string} text
 */
function parse(ts, text) {
	return ts.createSourceFile(
		'block.ts',
		text,
		99, // ScriptTarget.Latest
		true,
		3 // ScriptKind.TS
	)
}

/**
 * An identifier or string-literal name. Read through `idText`: golar's
 * TypeScript build has no `Identifier#text` getter.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').Identifier | import('typescript').StringLiteral} node
 */
function nameOf(ts, node) {
	return ts.isIdentifier(node) ? ts.idText(node) : node.text
}

/**
 * Local bindings an import declaration introduces.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').ImportDeclaration} statement
 */
function bindingsOf(ts, statement) {
	const clause = statement.importClause
	if (!clause || !ts.isStringLiteral(statement.moduleSpecifier)) return []
	const from = statement.moduleSpecifier.text
	const typeOnly = Boolean(clause.isTypeOnly)
	/** @type {Array<Binding>} */
	const bindings = []
	if (clause.name) {
		bindings.push({
			node: clause.name,
			local: nameOf(ts, clause.name),
			imported: 'default',
			from,
			typeOnly
		})
	}
	const named = clause.namedBindings
	if (named && ts.isNamespaceImport(named)) {
		bindings.push({
			node: named,
			local: nameOf(ts, named.name),
			imported: '*',
			from,
			typeOnly
		})
	} else if (named) {
		for (const element of named.elements) {
			bindings.push({
				node: element,
				local: nameOf(ts, element.name),
				imported: nameOf(ts, element.propertyName ?? element.name),
				from,
				typeOnly: typeOnly || element.isTypeOnly
			})
		}
	}
	return bindings
}

/**
 * Offset ranges to drop from an import so it no longer binds `dropped` -
 * always leaving valid syntax (`import A, {} from 'x'` included).
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').SourceFile} sourceFile
 * @param {import('typescript').ImportDeclaration} statement
 * @param {Array<Binding>} dropped
 */
function rangesToDrop(ts, sourceFile, statement, dropped) {
	const clause = /** @type {import('typescript').ImportClause} */ (
		statement.importClause
	)
	const named = clause.namedBindings
	const isDropped = (/** @type {import('typescript').Node} */ node) =>
		dropped.some((binding) => binding.node === node)
	/** @type {Array<[number, number]>} */
	const ranges = []

	if (clause.name && isDropped(clause.name) && named) {
		ranges.push([startOf(sourceFile, clause.name), startOf(sourceFile, named)])
	}
	if (named && ts.isNamespaceImport(named) && isDropped(named) && clause.name) {
		ranges.push([clause.name.end, named.end])
	}
	if (named && !ts.isNamespaceImport(named)) {
		const elements = named.elements
		if (elements.every(isDropped)) {
			ranges.push([startOf(sourceFile, named) + 1, named.end - 1])
		} else {
			elements.forEach((element, i) => {
				if (!isDropped(element)) return
				const next = elements[i + 1]
				ranges.push(
					next
						? [startOf(sourceFile, element), startOf(sourceFile, next)]
						: [
								/** @type {import('typescript').ImportSpecifier} */ (
									elements[i - 1]
								).end,
								element.end
							]
				)
			})
		}
	}
	return ranges.sort((a, b) => a[0] - b[0])
}

/**
 * Names a binding pattern (`a`, `{ a, b: [c] }`) declares.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').BindingName} name
 * @param {Set<string>} into
 */
function addBindingNames(ts, name, into) {
	if (ts.isIdentifier(name)) {
		into.add(nameOf(ts, name))
		return
	}
	for (const element of name.elements) {
		if (!ts.isOmittedExpression(element))
			addBindingNames(ts, element.name, into)
	}
}

/**
 * Value names a script binds at its top level: imports and declarations.
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').SourceFile} sourceFile
 * @param {{ typeImports: boolean }} options
 */
function topLevelNames(ts, sourceFile, options) {
	/** @type {Set<string>} */
	const names = new Set()
	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement)) {
			for (const binding of bindingsOf(ts, statement)) {
				if (options.typeImports || !binding.typeOnly) names.add(binding.local)
			}
		} else if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				addBindingNames(ts, declaration.name, names)
			}
		} else if (
			(ts.isFunctionDeclaration(statement) ||
				ts.isClassDeclaration(statement) ||
				ts.isEnumDeclaration(statement)) &&
			statement.name
		) {
			names.add(nameOf(ts, statement.name))
		}
	}
	return names
}

/** @type {import('@vue/language-core').VueLanguagePlugin<{ blockType?: string }>} */
const plugin = (ctx) => {
	const blockType = ctx.config.blockType ?? 'router'
	const ts = ctx.modules.typescript

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
			// as a single segment tagged (scriptSetup, 0), at module scope. The
			// block goes right behind it.
			let at = embeddedCode.content.findIndex(
				(segment) =>
					Array.isArray(segment) &&
					segment[1] === 'scriptSetup' &&
					segment[2] === 0
			)
			at = at === -1 ? 1 : at + 1

			// What the SFC's own scripts already import, at the same module scope,
			// and every value name they bind there.
			/** @type {Map<string, Binding>} */
			const imported = new Map()
			/** @type {Set<string>} */
			const scriptNames = new Set()
			for (const script of [ir.script, ir.scriptSetup]) {
				if (!script) continue
				const scriptFile = parse(ts, script.content)
				for (const statement of scriptFile.statements) {
					if (!ts.isImportDeclaration(statement)) continue
					for (const binding of bindingsOf(ts, statement)) {
						imported.set(binding.local, binding)
					}
				}
				for (const name of topLevelNames(ts, scriptFile, {
					typeImports: false
				})) {
					scriptNames.add(name)
				}
			}
			const alreadyImported = (/** @type {Binding} */ binding) => {
				const other = imported.get(binding.local)
				return (
					other !== undefined &&
					other.from === binding.from &&
					other.imported === binding.imported &&
					(!other.typeOnly || binding.typeOnly)
				)
			}

			const content = block.content
			const sourceFile = parse(ts, content)
			/**
			 * @param {number} start
			 * @param {number} end
			 * @returns {Array<import('@vue/language-core').Code>}
			 */
			const mapped = (start, end) =>
				start < end
					? [[content.slice(start, end), block.name, start, CODE_FEATURES]]
					: []

			/** @type {Array<import('@vue/language-core').Code>} */
			const imports = []
			/** @type {Array<import('@vue/language-core').Code>} */
			const body = []
			let bound = false
			// Each statement carries its leading trivia (comments, blank lines).
			let cursor = 0
			for (const statement of sourceFile.statements) {
				const start = cursor
				const end = statement.end
				cursor = end

				if (ts.isImportDeclaration(statement)) {
					const dropped = bindingsOf(ts, statement).filter(alreadyImported)
					const all = bindingsOf(ts, statement).length
					if (dropped.length > 0 && dropped.length === all) {
						imports.push(...mapped(start, startOf(sourceFile, statement)), '\n')
						continue
					}
					let from = start
					for (const [dropStart, dropEnd] of rangesToDrop(
						ts,
						sourceFile,
						statement,
						dropped
					)) {
						imports.push(...mapped(from, dropStart))
						from = Math.max(from, dropEnd)
					}
					imports.push(...mapped(from, end), '\n')
				} else if (
					!bound &&
					ts.isExportAssignment(statement) &&
					!statement.isExportEquals
				) {
					// Bind as `Route` without shifting the mapped expression.
					body.push(
						...mapped(start, startOf(sourceFile, statement)),
						'var Route = ',
						...mapped(startOf(sourceFile, statement.expression), end)
					)
					bound = true
				} else {
					body.push(...mapped(start, end))
				}
			}
			body.push(...mapped(cursor, content.length))

			// Names the scripts bind that the block does not bind itself.
			const blockNames = topLevelNames(ts, sourceFile, { typeImports: true })
			const shadowed = [...scriptNames].filter(
				(name) => name !== 'Route' && !blockNames.has(name)
			)
			const shadows =
				shadowed.length === 0
					? []
					: [
							'interface ImportThisInTheRouterBlock { readonly __tsrRouterBlockIsItsOwnModule: never }\n',
							`const ${shadowed.map((name) => `${name}: ImportThisInTheRouterBlock = null as never`).join(', ')};\n`,
							`void [${shadowed.join(', ')}];\n`
						]

			embeddedCode.content.splice(
				at,
				0,
				'\n',
				...imports,
				'{\n',
				...shadows,
				...body,
				'\n}\n',
				...(bound ? ['export { Route }\n'] : [])
			)
		}
	}
}

module.exports = plugin
