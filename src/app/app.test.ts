import { describe, expect, mock, test } from 'bun:test'
import {
	createRootRoute,
	createRoute,
	createMemoryHistory as createTanstackMemoryHistory,
	createRouter as createTanstackRouter
} from '@tanstack/vue-router'
import {
	createApp,
	createRenderer,
	effectScope,
	nextTick,
	reactive,
	readonly,
	ref
} from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { z } from 'zod'
import {
	assignFormState,
	createDialogs,
	createMaintenanceMode,
	createSaveScope,
	defineStaticData,
	formatDialogParam,
	formFeedbackKey,
	formStateFromSchema,
	getAtPath,
	isFormStateEqual,
	nuxtUiNavigate,
	parseApiError,
	parseDialogParam,
	preloadOnIntent,
	routeLoadingMode,
	searchFlag,
	setAtPath,
	trackRouteLoading,
	useEntityForm,
	useFormSubmit,
	useRouterPush,
	useRouteSearchModels,
	useRouteSearchSync,
	vueRouterShimOptions
} from './index'

/** Run `setup` in a mounted component, so `onMounted` hooks fire. */
function mountSetup(setup: () => void) {
	const node = () => ({})
	const { createApp } = createRenderer<object, object>({
		createElement: node,
		createText: node,
		createComment: node,
		insert: () => {},
		remove: () => {},
		patchProp: () => {},
		setText: () => {},
		setElementText: () => {},
		parentNode: () => null,
		nextSibling: () => null
	})
	createApp({
		setup() {
			setup()
			return () => null
		}
	}).mount({})
}

describe('routeLoadingMode', () => {
	test('a search-only change shows no loader', () => {
		expect(routeLoadingMode('/deals', '/deals')).toBeNull()
	})

	test('siblings in one layout tree load the outlet only', () => {
		expect(routeLoadingMode('/dashboard/overview', '/dashboard/stats')).toBe(
			'child'
		)
		expect(routeLoadingMode('/settings/team', '/settings/billing/plan')).toBe(
			'child'
		)
	})

	test('another section or a top-level hop loads the viewport', () => {
		expect(routeLoadingMode('/settings/team', '/deals')).toBe('full')
		expect(routeLoadingMode('/settings', '/settings/team')).toBe('full')
		expect(routeLoadingMode('', '/deals')).toBe('full')
	})
})

test('trackRouteLoading keeps its state on import.meta.hot.data', () => {
	const router = { subscribe: () => () => {} } as never
	const hot = { data: {} as Record<string, unknown> }
	const first = trackRouteLoading(router, { hot })
	first.state.value = null
	// The module re-runs after an HMR update.
	expect(trackRouteLoading(router, { hot }).state).toBe(first.state)
	expect(trackRouteLoading(router).state.value).toBe('full')
})

describe('searchFlag', () => {
	// A typed or shared `?create=true` reaches validateSearch as the boolean.
	test('accepts the boolean and the string an in-app navigation sends', () => {
		expect(searchFlag(true)).toBe(true)
		expect(searchFlag('true')).toBe(true)
	})

	test('treats anything else as absent instead of failing the route', () => {
		expect(searchFlag(undefined)).toBeUndefined()
		expect(searchFlag(false)).toBeUndefined()
		expect(searchFlag('yes')).toBeUndefined()
		expect(
			z
				.object({ create: z.unknown().optional().transform(searchFlag) })
				.parse({})
		).toEqual({ create: undefined })
	})
})

test('defineStaticData reads the deepest declaring match', () => {
	const shell = defineStaticData<{
		surface: 'ink' | 'paper'
		scroll: boolean
	}>()
	const matches = [
		{ staticData: shell.define({ surface: 'ink', scroll: true }) },
		{ staticData: shell.define({ surface: 'paper' }) },
		{}
	]
	expect(shell.inherited(matches, 'surface')).toBe('paper')
	expect(shell.inherited(matches, 'scroll')).toBe(true)
	expect(shell.inherited([{}], 'surface')).toBeUndefined()
})

test('vueRouterShimOptions resolves every path to the empty shim route', () => {
	const router = createRouter(vueRouterShimOptions(createMemoryHistory()))
	expect(router.resolve('/deals/1?tab=a').name).toBe('nuxt-shim')
})

describe('dialog search param', () => {
	test('round-trips a name with and without data', () => {
		expect(parseDialogParam(formatDialogParam('dealCreate'))).toEqual({
			name: 'dealCreate'
		})
		const data = { id: '1', note: 'a::b' }
		expect(parseDialogParam(formatDialogParam('dealDetail', data))).toEqual({
			name: 'dealDetail',
			data
		})
	})

	test('a hand-edited link with broken data reads as no data', () => {
		expect(parseDialogParam('dealDetail::{oops')).toEqual({
			name: 'dealDetail'
		})
		expect(parseDialogParam('dealDetail::42')).toEqual({ name: 'dealDetail' })
	})
})

describe('createDialogs', () => {
	function setup(initial: Record<string, unknown> = { tab: 'a' }) {
		const location = { pathname: '/deals', search: initial }
		const navigate = mock(
			async (options: {
				to: string
				search: (prev: Record<string, unknown>) => Record<string, unknown>
			}) => {
				location.search = options.search(location.search)
			}
		)
		const router = {
			state: { location, status: 'idle' },
			navigate
		} as never
		const closers: Array<(value: unknown) => void> = []
		const opened: Array<Record<string, unknown> | undefined> = []
		const created: Array<unknown> = []
		const onUnknownDialog = mock()
		const dialogs = createDialogs({
			dialogs: [
				{
					name: 'confirmAction',
					component: { name: 'Confirm' },
					hostProps: () => ({ title: 'Sure?' }),
					data: {} as { message: string },
					// Ignored: a confirm never reaches the URL.
					deepLink: true
				},
				{
					name: 'dealDetail',
					component: { name: 'DealDetail' },
					data: {} as { dealId: string },
					deepLink: (raw) =>
						typeof raw === 'object' &&
						raw !== null &&
						'dealId' in raw &&
						typeof raw.dealId === 'string'
							? { dealId: raw.dealId }
							: undefined
				},
				{
					name: 'dealCreate',
					component: { name: 'DealCreate' },
					deepLink: true
				},
				{ name: 'note', component: { name: 'Note' } }
			],
			host: { name: 'Host' },
			useOverlay: () => ({
				create: (_component, options) => {
					created.push(options)
					return {
						open: (props) => {
							opened.push(props)
							return { result: new Promise((r) => closers.push(r)) }
						}
					}
				}
			}),
			confirm: 'confirmAction',
			onUnknownDialog
		})
		return {
			dialogs,
			router,
			navigate,
			opened,
			created,
			onUnknownDialog,
			close: (value?: unknown) => closers.pop()?.(value),
			search: () => location.search
		}
	}

	test('mirrors a deepLink dialog into the URL until it closes', async () => {
		const { dialogs, router, opened, created, close, search } = setup()
		const result = dialogs.useOpenDialog(router)('dealDetail', {
			dealId: '1'
		})
		await Bun.sleep(0)
		expect(search()).toEqual({
			tab: 'a',
			openDialog: 'dealDetail::{"dealId":"1"}'
		})
		expect(opened[0]).toMatchObject({ data: { dealId: '1' } })
		// Every open is its own overlay; it must not pile up in Nuxt UI's list.
		expect(created).toEqual([{ destroyOnClose: true }])
		close('done')
		expect(await result).toBe('done')
		expect(search()).toEqual({ tab: 'a' })
	})

	test('a dialog without deepLink and a confirm never touch the URL', async () => {
		const { dialogs, router, navigate, opened, close } = setup()
		const note = dialogs.useOpenDialog(router)('note')
		const confirmed = dialogs.useConfirmAction(router)({ message: 'Delete?' })
		await Bun.sleep(0)
		expect(opened[1]).toMatchObject({
			title: 'Sure?',
			data: { message: 'Delete?' }
		})
		close(true)
		expect(await confirmed).toBe(true)
		close()
		await note
		expect(navigate).not.toHaveBeenCalled()
	})

	test('a dialog opened from a dialog leaves the outer one in the URL', async () => {
		const { dialogs, router, close, search } = setup()
		const open = dialogs.useOpenDialog(router)
		const outer = open('dealCreate')
		await Bun.sleep(0)
		const inner = open('dealDetail', { dealId: '2' })
		await Bun.sleep(0)
		expect(search().openDialog).toBe('dealCreate')
		close()
		await inner
		expect(search().openDialog).toBe('dealCreate')
		close()
		await outer
		expect(search().openDialog).toBeUndefined()
	})

	test('trackInUrl: false keeps one open out of the URL', async () => {
		const { dialogs, router, navigate, close } = setup()
		const result = dialogs.useOpenDialog(router)('dealCreate', undefined, {
			trackInUrl: false
		})
		close()
		await result
		expect(navigate).not.toHaveBeenCalled()
	})

	test('an unknown name opens nothing', async () => {
		const { dialogs, router, opened, onUnknownDialog } = setup()
		const open = dialogs.useOpenDialog(router) as (name: string) => unknown
		expect(await open('gone')).toBeUndefined()
		expect(opened).toEqual([])
		expect(onUnknownDialog).toHaveBeenCalledWith('gone')
	})

	describe('useDialogDeepLink', () => {
		async function openFromUrl(param: string) {
			const ctx = setup({ tab: 'a', openDialog: param })
			mountSetup(() => ctx.dialogs.useDialogDeepLink(ctx.router))
			await Bun.sleep(0)
			return ctx
		}

		test('reopens a deepLink dialog with the data its parser returns', async () => {
			const { opened, search } = await openFromUrl(
				'dealDetail::{"dealId":"1","extra":"x"}'
			)
			expect(opened[0]).toMatchObject({ data: { dealId: '1' } })
			expect(search().openDialog).toBe('dealDetail::{"dealId":"1"}')
		})

		for (const [why, param] of [
			['a confirm', 'confirmAction::{"message":"Your session expired"}'],
			['a dialog without deepLink', 'note'],
			['data the parser rejects', 'dealDetail::{"dealId":1}'],
			['an unknown name', 'gone']
		]) {
			test(`opens nothing for ${why} and clears the param`, async () => {
				const { opened, search, onUnknownDialog } = await openFromUrl(
					param as string
				)
				expect(opened).toEqual([])
				expect(search()).toEqual({ tab: 'a' })
				expect(onUnknownDialog).toHaveBeenCalledTimes(1)
			})
		}
	})
})

describe('maintenance mode', () => {
	test('parseApiError picks out what means the API is unavailable', () => {
		expect(parseApiError(new TypeError('Failed to fetch'))).toBe('api-down')
		// Safari and Firefox word it differently; wrapped clients keep the cause.
		expect(parseApiError(new TypeError('Load failed'))).toBe('api-down')
		expect(
			parseApiError(new Error('oRPC', { cause: new TypeError('x') }))
		).toBe('api-down')
		expect(parseApiError(new DOMException('aborted', 'AbortError'))).toBeNull()
		expect(parseApiError({ status: 503 })).toBe('maintenance')
		expect(parseApiError({ code: 503 })).toBe('maintenance')
		expect(parseApiError({ status: 500 })).toBeNull()
		expect(parseApiError(new Error('nope'))).toBeNull()
	})

	test('retries until the API answers, then recovers', async () => {
		const responses = [
			() => Promise.reject(new TypeError('Failed to fetch')),
			() => Promise.resolve(new Response(null, { status: 503 })),
			() => Promise.resolve(new Response(null, { status: 200 }))
		]
		const onRecovered = mock()
		const maintenance = createMaintenanceMode({
			probe: () => responses.shift()!(),
			retryIntervalSeconds: 9,
			onRecovered
		})
		try {
			expect(maintenance.triggerFromError({ status: 500 })).toBe(false)
			expect(maintenance.triggerFromError({ status: 503 })).toBe(true)
			expect(maintenance.isMaintenance.value).toBe(true)
			expect(maintenance.nextRetryIn.value).toBe(9)

			await maintenance.retryNow()
			expect(maintenance.isApiDown.value).toBe(true)
			await maintenance.retryNow()
			expect(maintenance.isMaintenance.value).toBe(true)
			expect(onRecovered).not.toHaveBeenCalled()
			await maintenance.retryNow()
			expect(maintenance.isActive.value).toBe(false)
			expect(maintenance.nextRetryIn.value).toBe(0)
			expect(onRecovered).toHaveBeenCalledTimes(1)
		} finally {
			maintenance.stop()
		}
	})

	test("only an OK answer recovers; a proxy's 502 is api-down", async () => {
		const responses = [
			new Response(null, { status: 502 }),
			new Response('{"message":"BAD_GATEWAY"}', { status: 503 }),
			new Response('{"message":"MAINTENANCE_MODE"}', { status: 503 })
		]
		const onRecovered = mock()
		const maintenance = createMaintenanceMode({
			probe: async () => responses.shift()!,
			isMaintenance: async (response) =>
				(await response.json()).message === 'MAINTENANCE_MODE',
			onRecovered
		})
		try {
			maintenance.trigger('maintenance')
			await maintenance.retryNow()
			expect(maintenance.isApiDown.value).toBe(true)
			await maintenance.retryNow()
			expect(maintenance.isApiDown.value).toBe(true)
			await maintenance.retryNow()
			expect(maintenance.isMaintenance.value).toBe(true)
			expect(onRecovered).not.toHaveBeenCalled()
		} finally {
			maintenance.stop()
		}
	})

	test('a slow probe is not started twice', async () => {
		let resolve: (response: Response) => void = () => {}
		const probe = mock(() => new Promise<Response>((r) => (resolve = r)))
		const maintenance = createMaintenanceMode({ probe, onRecovered: () => {} })
		const first = maintenance.retryNow()
		void maintenance.retryNow()
		resolve(new Response(null, { status: 200 }))
		await first
		expect(probe).toHaveBeenCalledTimes(1)
	})
})

describe('form state', () => {
	test('formStateFromSchema builds the empty state a schema describes', () => {
		const schema = z.object({
			name: z.string(),
			count: z.number(),
			active: z.boolean(),
			tags: z.array(z.string()),
			kind: z.enum(['a', 'b']),
			note: z.string().nullable(),
			nick: z.string().optional(),
			plan: z.string().default('free'),
			size: z.literal(3),
			address: z.object({ city: z.string() }),
			trimmed: z.string().transform((s) => s.trim())
		})
		expect(formStateFromSchema(schema, { name: 'Ada' })).toEqual({
			name: 'Ada',
			count: 0,
			active: false,
			tags: [],
			kind: 'a',
			note: null,
			nick: undefined,
			plan: 'free',
			size: 3,
			address: { city: '' },
			trimmed: ''
		})
	})

	test('paths read, write and refuse prototype keys', () => {
		const state: Record<string, unknown> = {}
		setAtPath(state, 'contacts.0.email', 'a@b.c')
		expect(state).toEqual({ contacts: [{ email: 'a@b.c' }] })
		expect(getAtPath(state, 'contacts.0.email')).toBe('a@b.c')
		expect(getAtPath(state, 'contacts.1.email')).toBeUndefined()
		expect(() => setAtPath(state, '__proto__.polluted', 1)).toThrow()
	})

	test('assignFormState copies out of readonly proxies', () => {
		const cached = readonly({ tags: ['a'] })
		const form = reactive<{ tags: string[] }>({ tags: [] })
		assignFormState(form, cached)
		form.tags.push('b')
		expect(cached.tags).toEqual(['a'])
		expect(isFormStateEqual(form, { tags: ['a', 'b'] })).toBe(true)
	})
})

test('useEntityForm keeps local edits across an unchanged refetch', async () => {
	const entity = ref<{ name: string } | null>(null)
	const scope = effectScope()
	const form = scope.run(() =>
		useEntityForm({
			entity,
			entityToForm: (e) => ({ name: e.name }),
			createEmptyForm: () => ({ name: '' })
		})
	)!
	entity.value = { name: 'Ada' }
	await nextTick()
	expect(form.form.name).toBe('Ada')

	form.form.name = 'Grace'
	expect(form.isDirty.value).toBe(true)
	entity.value = { name: 'Ada' }
	await nextTick()
	expect(form.form.name).toBe('Grace')

	form.reset()
	expect(form.isDirty.value).toBe(false)
	form.form.name = 'Grace'
	form.commit()
	expect(form.isDirty.value).toBe(false)
	scope.stop()
})

describe('useFormSubmit', () => {
	function run<T>(fn: () => T) {
		const success = mock()
		const error = mock()
		const app = createApp({})
		app.provide(formFeedbackKey, () => ({ success, error }))
		return { result: app.runWithContext(fn), success, error }
	}

	test('submits the built input and reports success', async () => {
		const submit = mock(async (input: unknown) => ({ saved: input }))
		const onDone = mock()
		const { result, success } = run(() =>
			useFormSubmit({
				initialState: { name: 'Ada' },
				submit,
				buildInput: (state) => ({ id: '1', data: { ...state } }),
				success: 'Saved',
				onDone
			})
		)
		const pending = result.onSubmit()
		expect(result.isPending.value).toBe(true)
		expect(await pending).toBe(true)
		expect(result.isPending.value).toBe(false)
		expect(submit).toHaveBeenCalledWith({ id: '1', data: { name: 'Ada' } })
		expect(success).toHaveBeenCalledWith('Saved')
		expect(onDone).toHaveBeenCalledWith({
			saved: { id: '1', data: { name: 'Ada' } }
		})
	})

	test('reports a failure with the form error title', async () => {
		const failure = new Error('boom')
		const { result, error, success } = run(() =>
			useFormSubmit({
				initialState: {},
				submit: () => Promise.reject(failure),
				success: 'Saved',
				errorTitle: 'Could not save'
			})
		)
		expect(await result.onSubmit()).toBe(false)
		expect(error).toHaveBeenCalledWith(failure, 'Could not save')
		expect(success).not.toHaveBeenCalled()
	})
})

describe('save scope', () => {
	function section(dirty: boolean, valid = true) {
		return {
			isDirty: ref(dirty),
			validate: mock(async () => valid),
			submit: mock(async () => true),
			reset: mock()
		}
	}

	test('validates and submits only the dirty sections', async () => {
		const scope = effectScope()
		const controller = scope.run(() => createSaveScope())!
		const dirty = section(true)
		const clean = section(false)
		controller.register(dirty)
		controller.register(clean)
		expect(controller.dirtyCount.value).toBe(1)

		dirty.submit.mockImplementation(async () => {
			dirty.isDirty.value = false
			return true
		})
		expect(await controller.save()).toBe(true)
		expect(clean.submit).not.toHaveBeenCalled()
		expect(controller.isSaved.value).toBe(true)
		scope.stop()
	})

	test('an invalid section stops the save before anything submits', async () => {
		const scope = effectScope()
		const controller = scope.run(() => createSaveScope())!
		const a = section(true)
		const b = section(true, false)
		controller.register(a)
		const unregister = controller.register(b)
		expect(await controller.save()).toBe(false)
		expect(a.submit).not.toHaveBeenCalled()

		controller.discard()
		expect(a.reset).toHaveBeenCalled()
		unregister()
		expect(controller.dirtyCount.value).toBe(1)
		scope.stop()
	})
})

describe('useRouterPush', () => {
	async function setup() {
		const root = createRootRoute()
		// Like a zod schema with `.loose()`: unknown keys stay.
		const validateSearch = (search: Record<string, unknown>) => search
		const deals = createRoute({
			getParentRoute: () => root,
			path: 'deals',
			validateSearch
		})
		const sessions = createRoute({
			getParentRoute: () => root,
			path: 'sessions',
			validateSearch
		})
		const router = createTanstackRouter({
			routeTree: root.addChildren([deals, sessions]),
			history: createTanstackMemoryHistory({
				initialEntries: ['/deals?view=mine']
			})
		})
		await router.load()
		return { router, push: useRouterPush(router) }
	}

	test('replaces the search, as navigate does', async () => {
		const { router, push } = await setup()
		await push({ to: '/sessions', search: { session: 's1' } })
		expect(router.state.location.href).toBe('/sessions?session=s1')
	})

	test("the legacy query never carries this page's search to another route", async () => {
		const { router, push } = await setup()
		await push('/deals', { query: { sort: 'amount' } })
		expect(router.state.location.search).toEqual({
			view: 'mine',
			sort: 'amount'
		})
		await push('/sessions', { query: { session: 's1' } })
		expect(router.state.location.search).toEqual({ session: 's1' })
	})

	test('newTab opens the built href instead of navigating', async () => {
		const { router, push } = await setup()
		const open = mock()
		const previous = globalThis.window
		globalThis.window = { open } as never
		try {
			await push({ to: '/sessions', search: { session: 's1' }, newTab: true })
		} finally {
			globalThis.window = previous
		}
		expect(open).toHaveBeenCalledWith(
			'/sessions?session=s1',
			'_blank',
			'noopener,noreferrer'
		)
		expect(router.state.location.pathname).toBe('/deals')
	})
})

test('useRouteSearchSync skips a write the URL already holds', async () => {
	const search = ref<{ q?: string }>({ q: 'a' })
	const local = ref('a')
	const navigate = mock()
	const scope = effectScope()
	scope.run(() =>
		useRouteSearchSync({
			search,
			navigate,
			read: () => ({ q: local.value }),
			write: (next) => {
				local.value = next.q ?? ''
			},
			sources: [local]
		})
	)
	// A URL change (back button) is written locally, and not echoed back...
	search.value = { q: 'b' }
	await nextTick()
	await Bun.sleep(0)
	expect(local.value).toBe('b')
	expect(navigate).not.toHaveBeenCalled()
	// ...but an edit is.
	local.value = 'c'
	await nextTick()
	expect(navigate).toHaveBeenCalledTimes(1)
	scope.stop()
})

test('nuxtUiNavigate navigates internal plain clicks only', () => {
	const navigate = mock()
	const handle = nuxtUiNavigate({ navigate } as never)
	const click = (init: Partial<MouseEvent> = {}) => {
		const event = { button: 0, preventDefault: mock(), ...init }
		return event as unknown as MouseEvent
	}
	const plain = click()
	handle(plain, { href: '/deals' })
	expect(plain.preventDefault).toHaveBeenCalled()
	expect(navigate).toHaveBeenCalledWith({ href: '/deals' })

	handle(click({ metaKey: true }), { href: '/deals' })
	handle(click(), { href: 'https://x.dev', external: true })
	handle(click(), { href: '/deals', target: '_blank' })
	handle(click({ defaultPrevented: true }), { href: '/deals' })
	expect(navigate).toHaveBeenCalledTimes(1)
})

describe('useRouteSearchModels', () => {
	function setup(initial: Record<string, unknown> = {}) {
		const search = ref<{ q?: string; tab?: string; page?: number }>(initial)
		const navigate = mock(
			(options: {
				search: (prev: typeof search.value) => typeof search.value
			}) => {
				search.value = options.search(search.value)
			}
		)
		const scope = effectScope()
		const models = scope.run(() => useRouteSearchModels(search, navigate))!
		return { search, navigate, scope, ...models }
	}

	test('writes in one tick are one navigation', async () => {
		const { search, navigate, searchModel, textModel } = setup({ page: 3 })
		textModel('q').value = 'acme'
		searchModel('tab', 'all').value = 'mine'
		searchModel('page', 1).value = 1
		expect(navigate).not.toHaveBeenCalled()
		await Bun.sleep(0)
		expect(navigate).toHaveBeenCalledTimes(1)
		expect(search.value).toEqual({ q: 'acme', tab: 'mine', page: 1 })
	})

	test('a debounced text model navigates once typing pauses', async () => {
		const { search, navigate, scope, textModel } = setup()
		const q = textModel('q', { debounce: 20 })
		q.value = 'a'
		q.value = 'ac'
		// The input shows the typed text before the URL has it.
		expect(q.value).toBe('ac')
		expect(navigate).not.toHaveBeenCalled()
		await Bun.sleep(40)
		expect(navigate).toHaveBeenCalledTimes(1)
		expect(search.value.q).toBe('ac')

		// The back button changes the URL: it wins over the old typed text.
		search.value = { q: 'x' }
		await nextTick()
		expect(q.value).toBe('x')

		// Typing back to what the URL holds navigates nowhere.
		q.value = 'xy'
		q.value = 'x'
		await Bun.sleep(40)
		expect(navigate).toHaveBeenCalledTimes(1)
		scope.stop()
	})
})

describe('preloading', () => {
	async function setup() {
		const loader = mock()
		const root = createRootRoute()
		const deals = createRoute({ getParentRoute: () => root, path: 'deals' })
		const sessions = createRoute({
			getParentRoute: () => root,
			path: 'sessions',
			loader
		})
		const router = createTanstackRouter({
			routeTree: root.addChildren([deals, sessions]),
			basepath: '/app',
			history: createTanstackMemoryHistory({ initialEntries: ['/app/deals'] })
		})
		await router.load()
		return { router, loader }
	}

	test('push.preload runs the loader without navigating', async () => {
		const { router, loader } = await setup()
		await useRouterPush(router).preload({ to: '/sessions' })
		expect(loader).toHaveBeenCalledTimes(1)
		expect(router.state.location.pathname).toBe('/deals')
	})

	test('preloadOnIntent preloads internal anchors only', async () => {
		const { router, loader } = await setup()
		class FakeElement {
			constructor(readonly anchor: object | null) {}
			closest() {
				return this.anchor
			}
		}
		const globals = globalThis as Record<string, unknown>
		const previous = { Element: globals.Element, window: globals.window }
		globals.Element = FakeElement
		globals.window = { location: { origin: 'https://app.test' } }
		const target = new EventTarget()
		const stop = preloadOnIntent(router, { target, delay: 0 })
		const touch = (anchor: Record<string, unknown>) => {
			const event = new Event('touchstart')
			Object.defineProperty(event, 'target', {
				value: new FakeElement({
					origin: 'https://app.test',
					search: '',
					hash: '',
					target: '',
					dataset: {},
					hasAttribute: () => false,
					...anchor
				})
			})
			target.dispatchEvent(event)
			return Bun.sleep(5)
		}
		try {
			await touch({ pathname: '/sessions', origin: 'https://other.test' })
			await touch({ pathname: '/sessions', target: '_blank' })
			await touch({ pathname: '/sessions', dataset: { preload: 'false' } })
			expect(loader).not.toHaveBeenCalled()
			// As Nuxt UI renders it (no basepath), then as `<Link>` does.
			await touch({ pathname: '/sessions' })
			expect(loader).toHaveBeenCalledTimes(1)
			await router.invalidate()
			router.clearCache()
			await touch({ pathname: '/app/sessions' })
			expect(loader).toHaveBeenCalledTimes(2)
			stop()
			router.clearCache()
			await touch({ pathname: '/sessions' })
			expect(loader).toHaveBeenCalledTimes(2)
		} finally {
			Object.assign(globals, previous)
		}
		expect(router.state.location.pathname).toBe('/deals')
	})
})
