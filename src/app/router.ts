import {
	type AnyRouter,
	type RegisteredRouter,
	useRouter,
	useRouterState
} from '@tanstack/vue-router'
import {
	computed,
	type Ref,
	type WatchSource,
	type WritableComputedRef,
	watch
} from 'vue'
import type { RouteRecordRaw, RouterHistory, RouterOptions } from 'vue-router'

/**
 * Options for the vue-router instance `@nuxt/ui` expects to find (its Vue
 * plugin may call vue-router APIs). One catch-all route that renders nothing:
 * navigation is TanStack Router's, so app code must not use `RouterLink`,
 * `RouterView` or vue-router's `useRoute`.
 *
 * `app.use(createRouter(vueRouterShimOptions(createWebHistory())))` - or
 * `createMemoryHistory()` when the app is embedded and must not own the URL.
 */
export function vueRouterShimOptions(history: RouterHistory): RouterOptions {
	const route: RouteRecordRaw = {
		path: '/:pathMatch(.*)*',
		name: 'nuxt-shim',
		component: { render: () => null }
	}
	return { history, routes: [route] }
}

/** Every full path of the registered route tree. */
export type AppPath = keyof RegisteredRouter['routesByPath'] & string

/**
 * One search param from the current location, as a string. Reads through
 * `useRouterState`, so it follows the URL (a `computed` over `router.state`
 * would not).
 */
export function useQueryParam(key: string): Readonly<Ref<string | undefined>> {
	return useRouterState({
		select: (state) =>
			new URLSearchParams(state.location.searchStr).get(key) ?? undefined
	})
}

type SearchNavigate<TSearch> = (options: {
	search: (prev: TSearch) => TSearch
	replace: true
}) => unknown

/**
 * Writable computeds over a route's typed search (mode toggles, view tabs,
 * selected ids). Reading falls back; writing navigates with `replace`.
 *
 * `const { searchModel } = useRouteSearchModels(Route.useSearch(), Route.useNavigate())`
 */
export function useRouteSearchModels<TSearch extends Record<string, unknown>>(
	search: Ref<TSearch>,
	navigate: SearchNavigate<TSearch>
) {
	function set(key: string, value: unknown) {
		void navigate({
			search: (prev) => ({ ...prev, [key]: value }),
			replace: true
		})
	}

	function searchModel<K extends keyof TSearch & string, const D>(
		key: K,
		fallback: D
	): WritableComputedRef<NonNullable<TSearch[K]> | D> {
		return computed({
			get: () => (search.value[key] ?? fallback) as NonNullable<TSearch[K]> | D,
			set: (value) => set(key, value)
		})
	}

	/**
	 * A string param as a plain `string`: empty reads and writes as an absent
	 * param, so a cleared search box leaves no `?q=` behind.
	 */
	function textModel<K extends keyof TSearch & string>(
		key: K
	): WritableComputedRef<string> {
		return computed({
			get: () => {
				const value = search.value[key]
				return typeof value === 'string' ? value : ''
			},
			set: (value) => set(key, value || undefined)
		})
	}

	return { searchModel, textModel }
}

/**
 * Keep local state and the URL in step both ways: a URL change is `write`n
 * into local state, a change to `sources` `read`s local state into the URL.
 * The echo of our own write is ignored, so neither side loops.
 */
export function useRouteSearchSync<TSearch extends Record<string, unknown>>({
	search,
	navigate,
	read,
	write,
	sources
}: {
	search: WatchSource<TSearch>
	navigate: SearchNavigate<TSearch>
	read: () => Partial<TSearch>
	write: (search: TSearch) => void
	sources: WatchSource<unknown>[]
}) {
	let applyingRouteSearch = false

	watch(
		search,
		(next) => {
			applyingRouteSearch = true
			write(next)
			queueMicrotask(() => {
				applyingRouteSearch = false
			})
		},
		{ deep: true }
	)

	watch(
		sources,
		() => {
			if (applyingRouteSearch) return
			void navigate({
				search: (prev) => ({ ...prev, ...read() }),
				replace: true
			})
		},
		{ flush: 'post' }
	)
}

type NavigateArg = Parameters<AnyRouter['navigate']>[0]
type BuildLocationArg = Parameters<AnyRouter['buildLocation']>[0]

/**
 * `push('/deals/$id', { params, query, newTab })`: navigate to an app path,
 * merging `query` into the current search, or open it in a new tab.
 * Call during setup; pass `router` to use one outside a component.
 */
export function useRouterPush(router: AnyRouter = useRouter()) {
	return async function push(
		to: AppPath,
		options?: {
			params?: Record<string, string>
			query?: Record<string, string>
			newTab?: boolean
		}
	) {
		const { params, query, newTab } = options ?? {}

		if (newTab) {
			// `to` is a union of paths, which collapses per-route typed `search`
			// to `never`; cast to keep the object shape while allowing the merge.
			const location = router.buildLocation({
				to,
				...(params ? { params } : {}),
				...(query ? { search: query } : {})
			} as BuildLocationArg)
			// The href `<Link>` renders: basepath and rewrites applied.
			const href = location.external
				? location.publicHref
				: router.history.createHref(location.publicHref)
			window.open(href, '_blank', 'noopener,noreferrer')
			return
		}

		await router.navigate({
			to,
			...(params ? { params } : {}),
			...(query
				? {
						search: (prev: Record<string, unknown>) => ({ ...prev, ...query })
					}
				: {})
		} as NavigateArg)
	}
}

/**
 * A search flag: `?create=true` arrives as the boolean when typed or shared
 * (the router JSON-parses search values) and as the string `'true'` from a
 * string-valued in-app navigation. Both mean `true`; anything else is absent
 * rather than a failed route. `create: z.unknown().optional().transform(searchFlag)`.
 */
export function searchFlag(value: unknown): true | undefined {
	return value === true || value === 'true' ? true : undefined
}

/**
 * Typed `staticData` for a route tree. TanStack's `StaticDataRouteOption` is
 * meant to be module-augmented, but it is declared in `@tanstack/router-core`,
 * which an app depending only on `@tanstack/vue-router` cannot augment - so
 * the contract lives in a value instead:
 *
 * `export const shell = defineStaticData<{ surface?: 'ink' | 'paper' }>()`,
 * `staticData: shell.define({ surface: 'ink' })` in a route, and
 * `shell.inherited(matches, 'surface')` in the frame.
 */
export function defineStaticData<T extends Record<string, unknown>>() {
	const read = (staticData: unknown) => (staticData ?? {}) as Partial<T>
	return {
		/** Identity, so the literal is type-checked where the route declares it. */
		define: (data: Partial<T>) => data,
		read,
		/** `key` from the deepest match that declares it - a parent's value covers its children. */
		inherited<K extends keyof T>(
			matches: ReadonlyArray<{ staticData?: unknown }>,
			key: K
		): T[K] | undefined {
			for (let i = matches.length - 1; i >= 0; i--) {
				const value = read(matches[i]?.staticData)[key]
				if (value !== undefined) return value
			}
			return undefined
		}
	}
}
