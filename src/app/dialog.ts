import { type AnyRouter, useRouter } from '@tanstack/vue-router'
import {
	type Component,
	type ComputedRef,
	computed,
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
}

/** The slice of Nuxt UI's `useOverlay()` the dialogs use. */
export type DialogOverlay = {
	create(component: Component): {
		open(props?: Record<string, unknown>): { result: Promise<unknown> }
	}
}

type DataOf<D, Name> = D extends { name: Name; data?: infer Data }
	? Exclude<Data, undefined>
	: never
type ResultOf<D, Name> = D extends { name: Name; result?: infer Result }
	? Exclude<Result, undefined>
	: never

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
	 * Mirror the dialog into the search param so a reload reopens it. `false`
	 * when the page already encodes the dialog in its own param - two deep
	 * links for one dialog open it twice.
	 */
	trackInUrl?: boolean
}

/**
 * Dialogs opened by name, through Nuxt UI's overlay, and mirrored into a
 * search param (`?openDialog=dealDetail::{"id":"1"}`) so a reload or a shared
 * link reopens them.
 *
 * ```ts
 * export const { useOpenDialog, useConfirmAction, useDialogDeepLink } =
 *   createDialogs({ dialogs, host: DialogSlideoverHost, useOverlay, confirm: 'confirmAction' })
 * ```
 *
 * `host` is the app's shell component. It gets `component` (the body, raw),
 * `data` (the body's props), the definition's `hostProps`, and must emit
 * `close` with the result - see `useDialogHost`.
 */
export function createDialogs<
	const D extends ReadonlyArray<DialogDefinition>,
	Confirm extends D[number]['name'] = never
>(options: {
	dialogs: D
	host: Component
	useOverlay: () => DialogOverlay
	/** The search param. Default `openDialog`. */
	searchKey?: string
	/** A registered dialog that resolves `true` when confirmed, for `useConfirmAction`. */
	confirm?: Confirm
	/** Called for a name no dialog is registered under (a stale deep link). */
	onUnknownDialog?: (name: string) => void
}) {
	const searchKey = options.searchKey ?? 'openDialog'

	function setSearchParam(router: AnyRouter, value: string | undefined) {
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

	/**
	 * Open a dialog by name. Resolves with what the dialog closed with, or
	 * `undefined` when it was dismissed or no dialog has that name. Call during setup; pass
	 * `router` to use one outside a component.
	 */
	function useOpenDialog(router: AnyRouter = useRouter()) {
		const overlay = options.useOverlay()

		return async <N extends D[number]['name']>(
			name: N,
			data?: DataOf<D[number], N>,
			openOptions?: OpenDialogOptions
		): Promise<ResultOf<D[number], N> | undefined> => {
			const def = options.dialogs.find((d) => d.name === name)
			if (!def) {
				options.onUnknownDialog?.(name)
				return undefined
			}
			const param =
				openOptions?.trackInUrl === false
					? undefined
					: formatDialogParam(name, data)
			if (param) await setSearchParam(router, param)

			const { result } = overlay.create(options.host).open({
				...def.hostProps?.(),
				component: markRaw(def.component),
				data
			})
			const value = (await result) as ResultOf<D[number], N> | undefined
			// Awaited so the cleanup cannot race (and cancel) a navigation the
			// caller makes as soon as the result resolves.
			if (param) await setSearchParam(router, undefined)
			return value
		}
	}

	/** Ask, and resolve to whether the user confirmed. Needs `confirm`. */
	function useConfirmAction(router?: AnyRouter) {
		const open = useOpenDialog(router)
		const name = options.confirm
		if (!name)
			throw new Error('createDialogs: pass `confirm` to use useConfirmAction()')
		return async (data: DataOf<D[number], Confirm>) =>
			(await open(name, data)) === true
	}

	/** Reopen the dialog the URL names. Call once in the root component's setup. */
	function useDialogDeepLink(router: AnyRouter = useRouter()) {
		const open = useOpenDialog(router)
		onMounted(() => {
			const raw = (router.state.location.search as Record<string, unknown>)[
				searchKey
			]
			if (typeof raw !== 'string' || !raw) return
			const { name, data } = parseDialogParam(raw)
			// The name comes from the URL; an unknown one is a no-op in `open`.
			void open(name, data as never)
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
