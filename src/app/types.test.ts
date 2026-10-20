import { expectTypeOf, test } from 'bun:test'
import { type Ref, ref } from 'vue'
import {
	createDialogs,
	useFormSubmit,
	useRouteSearchModels,
	useSettingsFormSection
} from './index'

// Checked by `tsc`, never run: the calls need a component context.
test('types are checked by the typecheck script', () => {})

export function dialogTypes() {
	const { useOpenDialog, useConfirmAction } = createDialogs({
		dialogs: [
			{
				name: 'dealDetail',
				component: {},
				data: {} as { dealId: string }
			},
			{
				name: 'dealCreate',
				component: {},
				result: {} as { id: string }
			},
			{ name: 'confirmAction', component: {}, data: {} as { message: string } }
		],
		host: {},
		useOverlay: () => ({
			create: () => ({ open: () => ({ result: Promise.resolve() }) })
		}),
		confirm: 'confirmAction'
	})
	const open = useOpenDialog()

	void open('dealDetail', { dealId: '1' })
	// @ts-expect-error - wrong data for the dialog
	void open('dealDetail', { id: '1' })
	// @ts-expect-error - no dialog by that name
	void open('dealDelete')
	expectTypeOf(open('dealCreate')).resolves.toEqualTypeOf<
		{ id: string } | undefined
	>()
	expectTypeOf(open('dealDetail')).resolves.toBeUnknown()

	const confirm = useConfirmAction()
	expectTypeOf(confirm({ message: 'Sure?' })).resolves.toBeBoolean()
	// @ts-expect-error - the confirm dialog's data
	void confirm({ text: 'Sure?' })
}

export function formSubmitTypes() {
	type Save = (input: { name: string }) => Promise<{ id: string }>
	type Update = (input: { id: string; data: { name: string } }) => Promise<true>
	const save = {} as Save
	const update = {} as Update

	const { onSubmit } = useFormSubmit({
		initialState: { name: '' },
		submit: save,
		onDone: (result) => expectTypeOf(result).toEqualTypeOf<{ id: string }>()
	})
	void onSubmit({ name: 'Ada' })

	// @ts-expect-error - the state is not an `update` input: needs buildInput
	useFormSubmit({ initialState: { name: '' }, submit: update })

	useFormSubmit({
		initialState: { name: '' },
		submit: update,
		buildInput: (state) => ({ id: '1', data: state })
	})

	useFormSubmit({
		initialState: { name: '' },
		submit: update,
		// @ts-expect-error - builds the wrong input
		buildInput: (state) => ({ data: state })
	})

	useSettingsFormSection({
		entity: ref<{ id: string; name: string } | null>(null),
		entityToForm: (entity) => ({ name: entity.name }),
		createEmptyForm: () => ({ name: '' }),
		submit: update,
		buildInput: (form) => ({ id: '1', data: form })
	})
}

export function searchModelTypes(search: Ref<{ view?: 'list' | 'grid' }>) {
	const { searchModel, textModel } = useRouteSearchModels(search, () => {})
	expectTypeOf(searchModel('view', 'list').value).toEqualTypeOf<
		'list' | 'grid'
	>()
	// @ts-expect-error - not a search key
	searchModel('tab', 'a')
	// @ts-expect-error - not a search key
	textModel('q')
}
