import { toRaw } from 'vue'
import type { z } from 'zod'

type ZodDef = {
	type?: string
	defaultValue?: unknown
	innerType?: z.ZodType
	schema?: z.ZodType
	in?: z.ZodType
	out?: z.ZodType
	options?: z.ZodType[]
	entries?: Record<string, unknown>
	values?: unknown[]
}

function defaultFor(schema: z.ZodType): unknown {
	const def = (schema as unknown as { _def: ZodDef })._def

	switch (def.type) {
		case 'default':
			return typeof def.defaultValue === 'function'
				? def.defaultValue()
				: def.defaultValue
		case 'optional':
			return undefined
		case 'nullable':
			return null
		case 'pipe':
			return defaultFor(def.in ?? def.out ?? schema)
		case 'union':
			return def.options?.[0] ? defaultFor(def.options[0]) : undefined
		case 'object': {
			const shape = (schema as z.ZodObject<z.ZodRawShape>).shape
			const result: Record<string, unknown> = {}
			for (const [key, child] of Object.entries(shape)) {
				result[key] = defaultFor(child as z.ZodType)
			}
			return result
		}
		case 'array':
			return []
		case 'boolean':
			return false
		case 'number':
		case 'bigint':
			return 0
		case 'enum':
			return Object.values(def.entries ?? {})[0]
		case 'literal':
			return def.values?.[0]
		case 'string':
			return ''
		default:
			if (def.schema) return defaultFor(def.schema)
			if (def.innerType) return defaultFor(def.innerType)
			return undefined
	}
}

/**
 * The empty form state a zod 4 schema describes: `.default()` values, `''`,
 * `0`, `false`, `[]`, `null` for nullable, the first enum option or union
 * member, then `overrides` on top.
 */
export function formStateFromSchema<T extends z.ZodType>(
	schema: T,
	overrides?: Partial<z.infer<T>>
): z.infer<T> {
	const base = defaultFor(schema)
	if (overrides && base && typeof base === 'object' && !Array.isArray(base)) {
		return { ...base, ...overrides } as z.infer<T>
	}
	return (overrides ?? base) as z.infer<T>
}

/** Deep-clone JSON-shaped values, unwrapping Vue reactive and readonly proxies. */
function clonePlain<T>(value: T): T {
	const raw = toRaw(value) as unknown
	if (Array.isArray(raw)) return raw.map(clonePlain) as T
	if (raw !== null && typeof raw === 'object') {
		const out: Record<string, unknown> = {}
		for (const [key, item] of Object.entries(raw)) out[key] = clonePlain(item)
		return out as T
	}
	return raw as T
}

/**
 * Assign `source` into a reactive form as plain copies, so the form never
 * holds (and mutates) a readonly query-cache proxy.
 */
export function assignFormState<T extends Record<string, unknown>>(
	target: T,
	source: Record<string, unknown>
) {
	Object.assign(target, clonePlain(source))
}

/** Stable deep equality for JSON-shaped form state (Vue proxies included). */
export function isFormStateEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

type Path = string | ReadonlyArray<string | number>

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function toPath(path: Path) {
	if (typeof path !== 'string') return path
	return path === '' ? [] : path.split('.')
}

/** A nested value by dot path (`contacts.0.email`); `undefined` when missing. */
export function getAtPath(object: unknown, path: Path): unknown {
	let current = object
	for (const key of toPath(path)) {
		if (current === null || typeof current !== 'object') return undefined
		current = (current as Record<PropertyKey, unknown>)[key]
	}
	return current
}

/** Write a nested value in place, creating arrays for numeric segments and objects otherwise. */
export function setAtPath(object: object, path: Path, value: unknown): void {
	const keys = toPath(path)
	if (keys.length === 0) throw new Error('Path must not be empty')
	for (const key of keys) {
		if (UNSAFE_KEYS.has(String(key))) {
			throw new Error(`Unsafe path segment: ${key}`)
		}
	}
	let current = object as Record<PropertyKey, unknown>
	for (let index = 0; index < keys.length - 1; index++) {
		const key = keys[index]!
		let next = current[key]
		if (next === null || typeof next !== 'object') {
			next = /^\d+$/.test(String(keys[index + 1])) ? [] : {}
			current[key] = next
		}
		current = next as Record<PropertyKey, unknown>
	}
	current[keys.at(-1)!] = value
}
