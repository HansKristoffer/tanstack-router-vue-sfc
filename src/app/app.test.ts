import { describe, expect, mock, test } from 'bun:test'
import { createApp, effectScope, nextTick, reactive, readonly, ref } from 'vue'
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
	parseApiError,
	parseDialogParam,
	routeLoadingMode,
	searchFlag,
	setAtPath,
	useEntityForm,
	useFormSubmit,
	vueRouterShimOptions
} from './index'

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

	test('a hand-edited link with broken data still opens the dialog', () => {
		expect(parseDialogParam('dealDetail::{oops')).toEqual({
			name: 'dealDetail'
		})
		expect(parseDialogParam('dealDetail::42')).toEqual({ name: 'dealDetail' })
	})
})

describe('createDialogs', () => {
	function setup() {
		let search: Record<string, unknown> = { tab: 'a' }
		const navigate = mock(
			async (options: {
				to: string
				search: (prev: Record<string, unknown>) => Record<string, unknown>
			}) => {
				search = options.search(search)
			}
		)
		const router = {
			state: { location: { pathname: '/deals', search } },
			navigate
		} as never
		let close: (value: unknown) => void = () => {}
		const opened: Array<Record<string, unknown> | undefined> = []
		const onUnknownDialog = mock()
		const host = { name: 'Host' }
		const dialogs = createDialogs({
			dialogs: [
				{
					name: 'confirmAction',
					component: { name: 'Confirm' },
					hostProps: () => ({ title: 'Sure?' }),
					data: {} as { message: string }
				}
			],
			host,
			useOverlay: () => ({
				create: (component) => {
					expect(component).toBe(host)
					return {
						open: (props) => {
							opened.push(props)
							return { result: new Promise((r) => (close = r)) }
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
			opened,
			onUnknownDialog,
			close: (value: unknown) => close(value),
			search: () => search
		}
	}

	test('mirrors the open dialog into the URL until it closes', async () => {
		const { dialogs, router, opened, close, search } = setup()
		const result = dialogs.useOpenDialog(router)('confirmAction', {
			message: 'Delete?'
		})
		await Bun.sleep(0)
		expect(search()).toEqual({
			tab: 'a',
			openDialog: 'confirmAction::{"message":"Delete?"}'
		})
		expect(opened[0]).toMatchObject({
			title: 'Sure?',
			data: { message: 'Delete?' }
		})
		close('done')
		expect(await result).toBe('done')
		expect(search()).toEqual({ tab: 'a' })
	})

	test('useConfirmAction resolves true only when confirmed', async () => {
		const { dialogs, router, close } = setup()
		const confirmed = dialogs.useConfirmAction(router)({ message: 'Delete?' })
		await Bun.sleep(0)
		close(undefined)
		expect(await confirmed).toBe(false)
	})

	test('an unknown name opens nothing', async () => {
		const { dialogs, router, opened, onUnknownDialog } = setup()
		expect(await dialogs.useOpenDialog(router)('gone' as never)).toBeUndefined()
		expect(opened).toEqual([])
		expect(onUnknownDialog).toHaveBeenCalledWith('gone')
	})
})

describe('maintenance mode', () => {
	test('parseApiError picks out what means the API is unavailable', () => {
		expect(parseApiError(new TypeError('Failed to fetch'))).toBe('api-down')
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
