import {
	type AnyRouter,
	RouterContextProvider,
	useRouter
} from '@tanstack/vue-router'
import {
	type Component,
	type ComputedRef,
	computed,
	type FunctionalComponent,
	h,
	markRaw,
	onMounted,
	toRaw
} from 'vue'

/** A named dialog `useOpenDialog` can open. */
export type DialogDefinition<
	Name extends string = string,
	Data = unknown,
	Result = unknown
> = {
	name: Name
	/** The dialog body, rendered inside the host. Usually `defineAsyncComponent`. */
	component: Component
	/**
	 * Extra props for the host (title, size, layout), resolved when the dialog
	 * opens so translated titles follow a locale switch.
	 */
	hostProps?: () => Record<string, unknown>
	/** Type-only: what the body takes as props. `data: {} as MyData`. */
	data?: Data
	/** Type-only: what the body closes with. `result: {} as { id: string }`. */
	result?: Result
	/**
	 * Mirror the dialog into the search param, so a reload or a shared link
	 * reopens it. Off by default: a URL is shared, logged and sent to
	 * analytics, and anyone can write one.
	 *
	 * - `true`: the name only. A link reopens the dialog without data.
	 * - a parser: the data too. A link reopens the dialog only with what the
	 *   parser returns for the link's data; `undefined` or a throw opens
	 *   nothing. `(raw) => DealDetailData.safeParse(raw).data`
	 */
	deepLink?: true | ((data: unknown) => Data | undefined)
}

/** The slice of Nuxt UI's `useOverlay()` the dialogs use. */
export type DialogOverlay = {
	create(
		component: Component,
		options?: { destroyOnClose?: boolean }
	): {
		open(props?: Record<string, unknown>): { result: Promise<unknown> }
	}
}

type DataOf<D, Name> = D extends { name: Name; data?: infer Data }
	? Exclude<Data, undefined>
	: never
type ResultOf<D, Name> = D extends { name: Name; result?: infer Result }
	? Exclude<Result, undefined>
	: never
/** `data` is required when the dialog's data has a required key. */
type OpenArgs<Data> =
	Record<never, never> extends Data
		? [data?: Data, options?: OpenDialogOptions]
		: [data: Data, options?: OpenDialogOptions]

/** `name` or `name::<json data>` - what the dialog search param holds. */
export function formatDialogParam(name: string, data?: unknown): string {
	return data === undefined ? name : `${name}::${JSON.stringify(data)}`
}

/** The inverse of `formatDialogParam`. Malformed data reads as none. */
export function parseDialogParam(raw: string): {
	name: string
	data?: Record<string, unknown>
} {
	const at = raw.indexOf('::')
	if (at === -1) return { name: raw }
	const name = raw.slice(0, at)
	try {
		const data: unknown = JSON.parse(raw.slice(at + 2))
		return data !== null && typeof data === 'object'
			? { name, data: data as Record<string, unknown> }
			: { name }
	} catch {
		return { name }
	}
}

type OpenDialogOptions = {
	/**
	 * `false` keeps a `deepLink` dialog out of the URL for this open - when
	 * the page already encodes the dialog in its own param (two deep links
	 * for one dialog open it twice).
	 */
	trackInUrl?: boolean
}

/** Nuxt UI renders overlays outside `RouterProvider`: give the host the router. */
function withRouter(host: Component, router: AnyRouter): Component {
	const Host: FunctionalComponent = (_props, { attrs }) =>
		h(RouterContextProvider, { router }, () => h(host, attrs))
	Host.inheritAttrs = false
	return markRaw(Host)
}

/** Resolves once the router has no navigation in flight (a guard's redirect). */
function settled(router: AnyRouter): Promise<void> {
	if (router.state.status !== 'pending') return Promise.resolve()
	return new Promise((resolve) => {
		const stop = router.subscribe('onResolved', () => {
			stop()
			resolve()
		})
	})
}

/**
 * Dialogs opened by name, through Nuxt UI's overlay. A dialog whose
 * definition has `deepLink` is mirrored into a search param
 * (`?openDialog=dealDetail::{"dealId":"1"}`) so a reload or a shared link
 * reopens it.
 *
 * ```ts
 * export const { useOpenDialog, useConfirmAction, useDialogDeepLink } =
 *   createDialogs({ dialogs, host: DialogSlideoverHost, useOverlay, confirm: 'confirmAction' })
 * ```
 *
 * `host` is the app's shell component, rendered inside the router's context.
 * It gets `component` (the body, raw), `data` (the body's props), the
 * definition's `hostProps`, and must emit `close` with the result - see
 * `useDialogHost`.
 */
export function createDialogs<
	const D extends ReadonlyArray<DialogDefinition>,
	Confirm extends D[number]['name'] = never
>(options: {
	dialogs: D
	host: Component
	useOverlay: () => DialogOverlay
	/** The search param. Default `openDialog`. The root route's `validateSearch` must keep it. */
	searchKey?: string
	/** A registered dialog that resolves `true` when confirmed, for `useConfirmAction`. Never in the URL. */
	confirm?: Confirm
	/** Called for a link that opens nothing: an unknown name, a dialog without `deepLink`, or data its parser rejects. */
	onUnknownDialog?: (name: string) => void
}) {
	const searchKey = options.searchKey ?? 'openDialog'
	const byName = new Map<string, DialogDefinition>()
	for (const def of options.dialogs) {
		if (byName.has(def.name))
			throw new Error(`createDialogs: two dialogs are named "${def.name}"`)
		byName.set(def.name, def)
	}
	// Only the outermost dialog is mirrored: a dialog opened from a dialog
	// must not overwrite, then delete, the param of the one below it.
	let openCount = 0

	function setSearchParam(router: AnyRouter, value: string | undefined) {
		const search = router.state.location.search as Record<string, unknown>
		if (search[searchKey] === value) return Promise.resolve()
		// Anchor to the committed location - `to: '.'` can resolve against a
		// pending navigation (an intent preload) and land on the wrong page.
		return router.navigate({
			to: router.state.location.pathname,
			replace: true,
			search: (prev: Record<string, unknown>) => {
				const next = { ...prev }
				if (value) next[searchKey] = value
				else delete next[searchKey]
				return next
			}
		} as Parameters<AnyRouter['navigate']>[0])
	}

	function paramFor(
		def: DialogDefinition,
		data: unknown,
		openOptions: OpenDialogOptions | undefined
	) {
		if (!def.deepLink || def.name === options.confirm) return undefined
		if (openCount > 0 || openOptions?.trackInUrl === false) return undefined
		return formatDialogParam(def.name, def.deepLink === true ? undefined : data)
	}

	/**
	 * Open a dialog by name. Resolves with what the dialog closed with, or
	 * `undefined` when it was dismissed or no dialog has that name. Call during setup; pass
	 * `router` to use one outside a component.
	 */
	function useOpenDialog(router: AnyRouter = useRouter()) {
		const overlay = options.useOverlay()
		const host = withRouter(options.host, router)

		return async <N extends D[number]['name']>(
			name: N,
			...[data, openOptions]: OpenArgs<DataOf<D[number], N>>
		): Promise<ResultOf<D[number], N> | undefined> => {
			const def = byName.get(name)
			if (!def) {
				options.onUnknownDialog?.(name)
				return undefined
			}
			const param = paramFor(def, data, openOptions)
			openCount++
			try {
				const { result } = overlay.create(host, { destroyOnClose: true }).open({
					...def.hostProps?.(),
					component: markRaw(def.component),
					data
				})
				// The dialog shows first; the URL follows once the route guards ran.
				const written = param ? setSearchParam(router, param) : undefined
				const value = (await result) as ResultOf<D[number], N> | undefined
				// Awaited so the cleanup cannot race (and cancel) a navigation the
				// caller makes as soon as the result resolves.
				if (param) {
					await written
					await setSearchParam(router, undefined)
				}
				return value
			} finally {
				openCount--
			}
		}
	}

	/** Ask, and resolve to whether the user confirmed. Needs `confirm`. */
	function useConfirmAction(router?: AnyRouter) {
		const open = useOpenDialog(router) as (
			name: string,
			data: unknown
		) => Promise<unknown>
		const name = options.confirm
		if (!name)
			throw new Error('createDialogs: pass `confirm` to use useConfirmAction()')
		return async (data: DataOf<D[number], Confirm>) =>
			(await open(name, data)) === true
	}

	/**
	 * Reopen the dialog the URL names, once the first navigation has settled.
	 * Call once in the root component's setup.
	 */
	function useDialogDeepLink(router: AnyRouter = useRouter()) {
		const open = useOpenDialog(router) as (
			name: string,
			data: unknown
		) => Promise<unknown>
		onMounted(async () => {
			await settled(router)
			const raw = (router.state.location.search as Record<string, unknown>)[
				searchKey
			]
			if (typeof raw !== 'string' || !raw) return
			const { name, data: linked } = parseDialogParam(raw)
			const def = byName.get(name)
			let data: unknown
			if (typeof def?.deepLink === 'function') {
				try {
					data = def.deepLink(linked)
				} catch {
					data = undefined
				}
			}
			const opens =
				def !== undefined &&
				def.name !== options.confirm &&
				(def.deepLink === true || data !== undefined)
			if (!opens) {
				await setSearchParam(router, undefined)
				options.onUnknownDialog?.(name)
				return
			}
			void open(name, data)
		})
	}

	return { useOpenDialog, useConfirmAction, useDialogDeepLink }
}

/**
 * The logic of a dialog host component: pass its props and `emit`.
 *
 * - `body`: the component for `<component :is>`, without deep reactivity
 * - `contentEvents`: for the overlay's content props - Escape closes, an
 *   outside click does not (the overlay is non-modal)
 * - `onOpenChange`: for `@update:open`, closing without a result
 * - `a11yTitle`: Reka UI requires a DialogTitle and DialogDescription even
 *   when the host draws its own header; never empty
 */
export function useDialogHost(
	props: { component: Component; title?: string },
	emit: (event: 'close', result?: unknown) => void
): {
	body: ComputedRef<Component>
	contentEvents: Record<string, (event: Event) => void>
	onOpenChange: (open: boolean) => void
	a11yTitle: ComputedRef<string>
} {
	return {
		body: computed(() => markRaw(toRaw(props.component))),
		contentEvents: {
			onInteractOutside: (event) => event.preventDefault(),
			onPointerDownOutside: (event) => event.preventDefault()
		},
		onOpenChange: (open) => {
			if (!open) emit('close')
		},
		a11yTitle: computed(() => props.title?.trim() || 'Dialog')
	}
}
