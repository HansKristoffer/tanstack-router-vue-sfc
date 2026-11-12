import { computed, readonly, ref } from 'vue'

/**
 * `maintenance`: the API answered 503 (planned downtime). `api-down`: the API
 * could not be reached at all.
 */
export type MaintenanceState = 'maintenance' | 'api-down'

function readHttpStatus(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) return undefined
	if ('status' in error && typeof error.status === 'number') return error.status
	if ('code' in error && typeof error.code === 'number') return error.code
	return undefined
}

/**
 * Whether an API error means the whole API is unavailable. `null` for errors
 * the app should handle itself (4xx, 500).
 *
 * `fetch` rejects with a `TypeError` when the API cannot be reached, in every
 * browser (the message differs: "Failed to fetch", "Load failed",
 * "NetworkError when attempting to fetch resource."). A client that wraps it
 * keeps it as `cause`. An abort is a `DOMException`, so it stays out.
 */
export function parseApiError(error: unknown): MaintenanceState | null {
	if (
		error instanceof TypeError ||
		(error instanceof Error && error.cause instanceof TypeError)
	) {
		return 'api-down'
	}
	return readHttpStatus(error) === 503 ? 'maintenance' : null
}

/**
 * Maintenance / API-down mode: `trigger` it from an API error, then it probes
 * every `retryIntervalSeconds` until the API answers, and recovers (by default
 * with a full reload, since every in-flight query failed).
 *
 * Create one per app, at module scope:
 * `export const maintenance = createMaintenanceMode({ probe: () => fetch('/api/health') })`
 */
export function createMaintenanceMode(options: {
	/**
	 * A request to the API's health route. Only an OK answer recovers; a 503
	 * is maintenance; anything else (a proxy's 502 or 504 while the API
	 * restarts) or a throw is api-down.
	 */
	probe: () => Promise<Response>
	/**
	 * Whether a 503 is the API's own maintenance answer, for apps whose proxy
	 * also answers 503. Default: every 503 is.
	 * `(response) => response.json().then((body) => body.message === 'MAINTENANCE_MODE')`
	 */
	isMaintenance?: (response: Response) => boolean | Promise<boolean>
	retryIntervalSeconds?: number
	onRecovered?: () => void
}) {
	const interval = options.retryIntervalSeconds ?? 15
	const onRecovered = options.onRecovered ?? (() => window.location.reload())
	const state = ref<MaintenanceState | null>(null)
	const nextRetryIn = ref(0)
	let timer: ReturnType<typeof setInterval> | undefined
	let checking = false

	function stopRetrying() {
		clearInterval(timer)
		timer = undefined
		nextRetryIn.value = 0
	}

	async function retryNow() {
		// The countdown keeps ticking during a slow probe; one at a time.
		if (checking) return
		checking = true
		try {
			const response = await options.probe()
			if (response.ok) {
				state.value = null
				stopRetrying()
				onRecovered()
				return
			}
			const maintenance =
				response.status === 503 &&
				(await (options.isMaintenance?.(response) ?? true))
			state.value = maintenance ? 'maintenance' : 'api-down'
		} catch {
			state.value = 'api-down'
		} finally {
			checking = false
		}
		nextRetryIn.value = interval
	}

	function trigger(next: MaintenanceState) {
		state.value = next
		if (timer) return
		nextRetryIn.value = interval
		timer = setInterval(() => {
			nextRetryIn.value = Math.max(0, nextRetryIn.value - 1)
			if (nextRetryIn.value === 0) void retryNow()
		}, 1000)
	}

	/** Trigger from an API error when it means the API is unavailable. Returns whether it did. */
	function triggerFromError(error: unknown) {
		const next = parseApiError(error)
		if (next) trigger(next)
		return next !== null
	}

	return {
		state: readonly(state),
		nextRetryIn: readonly(nextRetryIn),
		isActive: computed(() => state.value !== null),
		isMaintenance: computed(() => state.value === 'maintenance'),
		isApiDown: computed(() => state.value === 'api-down'),
		trigger,
		triggerFromError,
		retryNow,
		/** Stop the countdown without recovering (tests, teardown). */
		stop: stopRetrying
	}
}
