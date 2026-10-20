import { useBlocker } from '@tanstack/vue-router'
import {
	type ComputedRef,
	computed,
	type InjectionKey,
	inject,
	isReactive,
	type MaybeRefOrGetter,
	onScopeDispose,
	provide,
	type Ref,
	reactive,
	ref,
	shallowRef,
	toValue,
	unref,
	watch
} from 'vue'
import {
	assignFormState,
	getAtPath,
	isFormStateEqual,
	setAtPath
} from './form-state'

// ─────────────────────────────────────────────────────────────
// Form context: what the app's form shell provides to its fields
// ─────────────────────────────────────────────────────────────

/** The form's state, provided by the app's form component. */
export const formStateKey: InjectionKey<Ref<Record<string, unknown>>> =
	Symbol('formState')
/** The form element's id, so a submit button outside it can target it. */
export const formIdKey: InjectionKey<Ref<string>> = Symbol('formId')

/**
 * The `form=` target for a submit button: the explicit id, else the enclosing
 * form's, else none (then the button is `type="button"` and emits instead).
 */
export function useResolvedFormId(
	formId: () => string | undefined
): ComputedRef<string | undefined> {
	const injected = inject(formIdKey, null)
	return computed(() => formId() ?? unref(injected) ?? undefined)
}

export type FormFieldBindings = {
	// biome-ignore lint/suspicious/noExplicitAny: a path binds to any control's model
	modelValue: any
	// biome-ignore lint/suspicious/noExplicitAny: a path binds to any control's model
	'onUpdate:modelValue': (value: any) => void
}

/**
 * `v-model` bindings for the field at `name` (a dot path) in the enclosing
 * form's state. The state is required only when the bindings are READ, so a
 * field component can also wrap a control that has its own `v-model`.
 */
export function useFormFieldModel(
	name: string
): ComputedRef<FormFieldBindings> {
	const stateRef = inject(formStateKey, null)
	const requireState = () => {
		if (!stateRef) {
			throw new Error(
				`Field "${name}" reads form state, so it must be inside a form that provides formStateKey.`
			)
		}
		return stateRef.value
	}
	return computed(() => ({
		get modelValue() {
			return getAtPath(requireState(), name)
		},
		'onUpdate:modelValue': (value: unknown) => {
			setAtPath(requireState(), name, value)
		}
	}))
}

// ─────────────────────────────────────────────────────────────
// Entity-backed form state
// ─────────────────────────────────────────────────────────────

/**
 * A form hydrated from a server entity, with dirty tracking: `reset` back to
 * the last hydrated state, `commit` the form as the new clean state after a
 * save. A refetch returning unchanged data does not clobber local edits.
 */
export function useEntityForm<
	TEntity,
	TForm extends Record<string, unknown>
>(options: {
	entity: MaybeRefOrGetter<TEntity | null | undefined>
	entityToForm: (entity: TEntity) => TForm
	createEmptyForm: () => TForm
}) {
	const form = reactive(options.createEmptyForm()) as TForm
	const snapshot = reactive(options.createEmptyForm()) as TForm

	watch(
		() => toValue(options.entity),
		(entity) => {
			if (!entity) return
			const next = options.entityToForm(entity)
			if (isFormStateEqual(next, snapshot)) return
			assignFormState(form, next)
			assignFormState(snapshot, next)
		},
		{ immediate: true }
	)

	return {
		form,
		isDirty: computed(() => !isFormStateEqual(form, snapshot)),
		reset: () => assignFormState(form, snapshot),
		commit: () => assignFormState(snapshot, form)
	}
}

/**
 * Tint the fields an edit from OUTSIDE the form just changed (an assistant,
 * a realtime update), for `ms`. Each call restarts the timer for its own
 * fields.
 */
export function useFieldHighlight<TField extends string>(ms = 2500) {
	const highlighted = shallowRef(new Set<TField>())
	let timeout: ReturnType<typeof setTimeout> | undefined
	onScopeDispose(() => clearTimeout(timeout))

	return {
		highlight(fields: readonly TField[]) {
			if (fields.length === 0) return
			highlighted.value = new Set(fields)
			clearTimeout(timeout)
			timeout = setTimeout(() => {
				highlighted.value = new Set()
			}, ms)
		},
		isHighlighted: (field: TField) => highlighted.value.has(field)
	}
}

// ─────────────────────────────────────────────────────────────
// Submitting
// ─────────────────────────────────────────────────────────────

/** How the app tells the user a save went through or failed (toasts, i18n). */
export type FormFeedback = {
	success(message: string): void
	/** `title` is the form's `errorTitle`, if it set one. */
	error(error: unknown, title: string | undefined): void
}

/**
 * Provide once at the app root. A factory, called in each form's setup, so it
 * can use composables (`useToast`, `useI18n`):
 * `app.provide(formFeedbackKey, () => { const toast = useToast(); return { ... } })`
 */
export const formFeedbackKey: InjectionKey<() => FormFeedback> =
	Symbol('formFeedback')

const consoleFeedback: FormFeedback = {
	success: () => {},
	error: (error) => console.error('[form] submit failed', error)
}

/**
 * Submit a form through `submit` (a mutation), reporting through the app's
 * `FormFeedback`. Resolves `true` on success. Inside a save scope the scope
 * announces the save, so `success` is not shown per section.
 */
export function useFormSubmit<
	TState extends Record<string, unknown>,
	TResult
>(options: {
	initialState: TState
	submit: (input: unknown) => Promise<TResult>
	/** The mutation input, when it is not the form state itself. */
	buildInput?: (state: TState) => unknown
	/** Shown on success (outside a save scope). */
	success?: string
	errorTitle?: string
	/** After a successful submit, with its result: invalidate, close, navigate. */
	onDone?: (result: TResult) => void
}) {
	const feedback = inject(formFeedbackKey, null)?.() ?? consoleFeedback
	const saveScope = useOptionalSaveScopeController()
	const isPending = ref(false)
	const state = isReactive(options.initialState)
		? options.initialState
		: (reactive({ ...options.initialState }) as TState)

	async function onSubmit(values?: unknown) {
		isPending.value = true
		try {
			const result = await options.submit(
				options.buildInput ? options.buildInput(state) : (values ?? state)
			)
			if (options.success && !saveScope) feedback.success(options.success)
			options.onDone?.(result)
			return true
		} catch (error) {
			feedback.error(error, options.errorTitle)
			return false
		} finally {
			isPending.value = false
		}
	}

	return { state, onSubmit, isPending }
}

/**
 * An entity-backed form section: `useEntityForm` + `useFormSubmit`, committing
 * the form as clean after a successful save. Register it with a save scope
 * through `useSaveSection` when it sits under one.
 */
export function useSettingsFormSection<
	TEntity,
	TForm extends Record<string, unknown>,
	TResult
>(options: {
	entity: MaybeRefOrGetter<TEntity | null | undefined>
	entityToForm: (entity: TEntity) => TForm
	createEmptyForm: () => TForm
	submit: (input: unknown) => Promise<TResult>
	buildInput?: (state: TForm) => unknown
	success?: string
	errorTitle?: string
	onDone?: (result: TResult) => void
}) {
	const { form, isDirty, reset, commit } = useEntityForm(options)
	const { onSubmit: submit, isPending } = useFormSubmit({
		...options,
		initialState: form
	})

	async function onSubmit(values?: unknown) {
		const ok = await submit(values)
		if (ok) commit()
		return ok
	}

	return { form, isDirty, reset, onSubmit, isPending }
}

// ─────────────────────────────────────────────────────────────
// Save scope: one Save / Discard for several form sections
// ─────────────────────────────────────────────────────────────

export type SaveSection = {
	isDirty: MaybeRefOrGetter<boolean>
	/** `false` when invalid (the section shows its own errors). */
	validate?: () => Promise<boolean>
	/** `true` on success. The section reports its own errors. */
	submit: () => Promise<boolean>
	reset: () => void
}

export type SaveScopeController = {
	isDirty: ComputedRef<boolean>
	isSaving: Ref<boolean>
	/** True for `savedIndicatorMs` after a save. */
	isSaved: Ref<boolean>
	dirtyCount: ComputedRef<number>
	/** Validate every dirty section, then submit them together. */
	save: () => Promise<boolean>
	discard: () => void
	register: (section: SaveSection) => () => void
}

const saveScopeKey: InjectionKey<SaveScopeController> = Symbol('saveScope')

/** A save scope without providing it. Most callers want `provideSaveScope`. */
export function createSaveScope(options?: {
	/**
	 * Block navigation (and unload) while dirty, unless this confirms leaving:
	 * `() => window.confirm(t('unsavedChanges'))`. Needs a router in context.
	 */
	confirmLeave?: () => boolean | Promise<boolean>
	savedIndicatorMs?: number
}): SaveScopeController {
	const sections = shallowRef(new Set<SaveSection>())
	const isSaving = ref(false)
	const isSaved = ref(false)
	let savedTimer: ReturnType<typeof setTimeout> | undefined
	onScopeDispose(() => clearTimeout(savedTimer))

	function register(section: SaveSection) {
		sections.value = new Set(sections.value).add(section)
		return () => {
			const next = new Set(sections.value)
			next.delete(section)
			sections.value = next
		}
	}

	const dirtySections = computed(() =>
		[...sections.value].filter((section) => toValue(section.isDirty))
	)
	const dirtyCount = computed(() => dirtySections.value.length)
	const isDirty = computed(() => dirtyCount.value > 0)

	watch(isDirty, (dirty) => {
		if (dirty) isSaved.value = false
	})

	async function save() {
		if (isSaving.value) return false
		if (!isDirty.value) return true
		const targets = dirtySections.value
		isSaved.value = false
		isSaving.value = true
		try {
			for (const section of targets) {
				if (section.validate && !(await section.validate())) return false
			}
			const results = await Promise.all(targets.map((s) => s.submit()))
			const ok = results.every(Boolean)
			if (ok) {
				isSaved.value = !isDirty.value
				clearTimeout(savedTimer)
				savedTimer = setTimeout(() => {
					isSaved.value = false
				}, options?.savedIndicatorMs ?? 2400)
			}
			return ok
		} finally {
			isSaving.value = false
		}
	}

	function discard() {
		for (const section of sections.value) section.reset()
	}

	const confirmLeave = options?.confirmLeave
	if (confirmLeave) {
		useBlocker({
			shouldBlockFn: async () => isDirty.value && !(await confirmLeave()),
			enableBeforeUnload: () => isDirty.value
		})
	}

	return { isDirty, isSaving, isSaved, dirtyCount, save, discard, register }
}

/** Create a save scope and provide it to the sections below. */
export function provideSaveScope(
	options?: Parameters<typeof createSaveScope>[0]
): SaveScopeController {
	const controller = createSaveScope(options)
	provide(saveScopeKey, controller)
	return controller
}

export function useSaveScopeController(): SaveScopeController {
	const controller = inject(saveScopeKey, null)
	if (!controller) {
		throw new Error(
			'useSaveScopeController() must be used inside provideSaveScope()'
		)
	}
	return controller
}

export function useOptionalSaveScopeController(): SaveScopeController | null {
	return inject(saveScopeKey, null)
}

/**
 * Register a section with the nearest save scope; a no-op without one (a
 * standalone card keeps its own footer). `inject` only sees ancestors, so the
 * component that provides the scope registers with `controller.register`.
 */
export function useSaveSection(section: SaveSection) {
	const controller = inject(saveScopeKey, null)
	if (!controller) return
	onScopeDispose(controller.register(section))
}
