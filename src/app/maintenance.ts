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
 */
export function parseApiError(error: unknown): MaintenanceState | null {
	if (error instanceof Error && error.message.includes('Failed to fetch')) {
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
	/** Any request to the API. A 503 response keeps maintenance; a throw is api-down. */
	probe: () => Promise<Response>
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
			if (response.status === 503) {
				state.value = 'maintenance'
			} else {
				state.value = null
				stopRetrying()
				onRecovered()
				return
			}
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
