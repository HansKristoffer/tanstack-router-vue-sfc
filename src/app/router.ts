import {
	type AnyRouter,
	type NavigateOptions,
	type RegisteredRouter,
	type ToPathOption,
	useRouter,
	useRouterState
} from '@tanstack/vue-router'
import {
	computed,
	type Ref,
	toValue,
	type WatchSource,
	type WritableComputedRef,
	watch
} from 'vue'
import type { RouteRecordRaw, RouterHistory, RouterOptions } from 'vue-router'
import { isFormStateEqual } from './form-state'

/**
 * Nuxt UI's link handler for an app without vue-router. Internal links
 * navigate through TanStack Router; external links, a `target` and modified
 * clicks keep the browser's behaviour.
 *
 * ```ts
 * // vite.config.ts
 * ui({ router: false })
 * // main.ts
 * app.use(nuxtUi, { router: nuxtUiNavigate(router) })
 * ```
 *
 * In this mode a Nuxt UI link is active only when it gets `active`.
 */
export function nuxtUiNavigate(router: AnyRouter) {
	return (
		event: MouseEvent,
		link: { href: string; external?: boolean; target?: string }
	) => {
		if (event.defaultPrevented || link.external) return
		if (link.target && link.target !== '_self') return
		if (event.button !== 0 || event.metaKey || event.ctrlKey) return
		if (event.shiftKey || event.altKey) return
		event.preventDefault()
		void router.navigate({ href: link.href })
	}
}

/**
 * Options for the vue-router instance `@nuxt/ui` expects to find (its Vue
 * plugin may call vue-router APIs). One catch-all route that renders nothing:
 * navigation is TanStack Router's, so app code must not use `RouterLink`,
 * `RouterView` or vue-router's `useRoute`.
 *
 * `app.use(createRouter(vueRouterShimOptions(createWebHistory())))` - or
 * `createMemoryHistory()` when the app is embedded and must not own the URL.
 *
 * @deprecated Use Nuxt UI's `router: false` mode with `nuxtUiNavigate`.
 * Removed, with the `vue-router` peer, in the next major.
 */
export function vueRouterShimOptions(history: RouterHistory): RouterOptions {
	const route: RouteRecordRaw = {
		path: '/:pathMatch(.*)*',
		name: 'nuxt-shim',
		component: { render: () => null }
	}
	return { history, routes: [route] }
}

/**
 * Every path `navigate({ to })`, `Link` and `redirect` accept for the route
 * tree: `/admin`, not the full path `/admin/` of its index route.
 */
export type AppPath<TRouter extends AnyRouter = RegisteredRouter> =
	ToPathOption<TRouter, '/', ''>

/**
 * One search param from the current location, as a string (a number or a
 * boolean the router parsed reads as it was written). Reads through
 * `useRouterState`, so it follows the URL (a `computed` over `router.state`
 * would not).
 */
export function useQueryParam(key: string): Readonly<Ref<string | undefined>> {
	return useRouterState({
		select: (state) => {
			const value = (state.location.search as Record<string, unknown>)[key]
			if (value === undefined) return undefined
			return typeof value === 'string' ? value : JSON.stringify(value)
		}
	})
}

type SearchNavigate<TSearch> = (options: {
	search: (prev: TSearch) => TSearch
	replace: true
}) => unknown

/** A route object (`Route` in a single-file route): its search type is phantom. */
type SearchRoute = {
	types: { fullSearchSchema: unknown }
	useSearch(): Ref<unknown>
	useNavigate(): unknown
}
type SearchOf<R extends SearchRoute> = R['types']['fullSearchSchema'] &
	Record<string, unknown>

/**
 * Writable computeds over a route's typed search (mode toggles, view tabs,
 * selected ids). Reading falls back; writing navigates with `replace`.
 *
 * `const { searchModel } = useRouteSearchModels(Route)`, or
 * `useRouteSearchModels(Route.useSearch(), Route.useNavigate())`.
 */
export function useRouteSearchModels<R extends SearchRoute>(
	route: R
): ReturnType<typeof searchModels<SearchOf<R>>>
export function useRouteSearchModels<TSearch extends Record<string, unknown>>(
	search: Ref<TSearch>,
	navigate: SearchNavigate<TSearch>
): ReturnType<typeof searchModels<TSearch>>
export function useRouteSearchModels<TSearch extends Record<string, unknown>>(
	searchOrRoute: Ref<TSearch> | SearchRoute,
	navigate?: SearchNavigate<TSearch>
) {
	return 'useSearch' in searchOrRoute
		? searchModels(
				searchOrRoute.useSearch() as Ref<TSearch>,
				searchOrRoute.useNavigate() as SearchNavigate<TSearch>
			)
		: searchModels(searchOrRoute, navigate!)
}

function searchModels<TSearch extends Record<string, unknown>>(
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
 * A change that the URL already holds (the echo of a URL change, however
 * late a debounced source fires) navigates nowhere, so neither side loops.
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
	watch(search, (next) => write(next), { deep: true })

	watch(
		sources,
		() => {
			const current = toValue(search) as Record<string, unknown>
			const next = read() as Record<string, unknown>
			if (
				Object.keys(next).every((key) =>
					isFormStateEqual(next[key], current[key])
				)
			) {
				return
			}
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

type LegacyPushOptions = {
	params?: Record<string, string>
	query?: Record<string, string>
	newTab?: boolean
}

/**
 * `push({ to, params, search, newTab })`: `router.navigate` with the same
 * typed options, plus `newTab` to open the location in a new tab instead.
 * Call during setup; pass `router` to use one outside a component.
 *
 * `search` replaces the current search, as in `navigate`; merge with
 * `search: (prev) => ({ ...prev, tab: 'x' })` on the same route.
 */
export function useRouterPush<TRouter extends AnyRouter = RegisteredRouter>(
	router: TRouter = useRouter() as TRouter
) {
	function push<
		TTo extends string | undefined,
		TFrom extends string = string,
		TMaskFrom extends string = TFrom,
		TMaskTo extends string = ''
	>(
		options: NavigateOptions<TRouter, TFrom, TTo, TMaskFrom, TMaskTo> & {
			newTab?: boolean
		}
	): Promise<void>
	/**
	 * @deprecated Use `push({ to, params, search })`. `query` merges into the
	 * current search only when `to` is the current page; another route gets
	 * `query` alone, since its schema would reject this page's params.
	 */
	function push(
		to: AppPath<TRouter>,
		options?: LegacyPushOptions
	): Promise<void>
	async function push(arg: unknown, legacy?: LegacyPushOptions): Promise<void> {
		const { newTab, ...navigation } =
			typeof arg === 'string'
				? legacyNavigation(arg, legacy)
				: (arg as { newTab?: boolean })

		if (newTab) {
			const location = router.buildLocation(navigation as BuildLocationArg)
			// The href `<Link>` renders: basepath and rewrites applied.
			const href = location.external
				? location.publicHref
				: router.history.createHref(location.publicHref)
			window.open(href, '_blank', 'noopener,noreferrer')
			return
		}
		await router.navigate(navigation as NavigateArg)
	}

	function legacyNavigation(to: string, options: LegacyPushOptions = {}) {
		const { params, query, newTab } = options
		const samePage =
			query !== undefined &&
			!newTab &&
			router.buildLocation({ to, params } as BuildLocationArg).pathname ===
				router.state.location.pathname
		return {
			to,
			newTab,
			...(params ? { params } : {}),
			...(query
				? {
						search: samePage
							? (prev: Record<string, unknown>) => ({ ...prev, ...query })
							: query
					}
				: {})
		}
	}

	return push
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
 * Typed `staticData` as a value, with `inherited` to read the deepest match
 * that declares a key. To type `staticData` itself, augment TanStack's
 * interface instead - it works through `@tanstack/vue-router`, like `Register`:
 * `declare module '@tanstack/vue-router' { interface StaticDataRouteOption { surface?: 'ink' | 'paper' } }`.
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
