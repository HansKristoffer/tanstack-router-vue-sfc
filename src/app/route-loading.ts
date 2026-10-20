import type { AnyRouter } from '@tanstack/vue-router'
import { nextTick, type Ref, ref } from 'vue'

/**
 * `full` covers the whole viewport (a different layout tree), `child` only the
 * content outlet (same layout, so nested sidebars stay visible).
 */
export type RouteLoadingMode = 'full' | 'child'

/**
 * Which loader a navigation between two pathnames shows; `null` for none (the
 * pathname did not change - a search-only change such as `?openDialog=`).
 *
 * Paths sharing two segments (`/dashboard/a` -> `/dashboard/b`), or one
 * segment when both sides are nested (`/settings/team` -> `/settings/billing`),
 * stay in one layout tree and load as `child`.
 */
export function routeLoadingMode(
	fromPathname: string,
	toPathname: string
): RouteLoadingMode | null {
	if (fromPathname === toPathname) return null
	const a = fromPathname.split('/').filter(Boolean)
	const b = toPathname.split('/').filter(Boolean)
	let shared = 0
	while (shared < Math.min(a.length, b.length) && a[shared] === b[shared]) {
		shared++
	}
	const sameTree =
		shared >= 2 || (shared >= 1 && a.length >= 2 && b.length >= 2)
	return sameTree ? 'child' : 'full'
}

/**
 * Drive `state` from the router: set on navigation start, cleared once it
 * resolves. Starts as `full` so the first navigation is covered too.
 *
 * Pass a `state` kept on `import.meta.hot.data` so an HMR update of the module
 * that calls this does not reset it mid-session.
 */
export function trackRouteLoading(
	router: AnyRouter,
	state: Ref<RouteLoadingMode | null> = ref('full')
) {
	const stops = [
		router.subscribe('onBeforeNavigate', (event) => {
			state.value = routeLoadingMode(
				event.fromLocation?.pathname ?? '',
				event.toLocation.pathname
			)
		}),
		router.subscribe('onResolved', () => {
			void nextTick(() => {
				state.value = null
			})
		})
	]
	return {
		state,
		stop: () => {
			for (const stop of stops) stop()
		}
	}
}
