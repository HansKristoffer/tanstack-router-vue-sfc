# tanstack-router-sfc

[![CI](https://github.com/HansKristoffer/tanstack-router-vue-sfc/actions/workflows/ci.yml/badge.svg)](https://github.com/HansKristoffer/tanstack-router-vue-sfc/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tanstack-router-sfc)](https://www.npmjs.com/package/tanstack-router-sfc)

TanStack Router for Vue where **one `.vue` file is the whole route**: the route
definition lives in a `<router lang="ts">` custom block next to the component
that renders it.

```vue
<template>
	<article>{{ post.title }}</article>
</template>

<script setup lang="ts">
// `Route` is in scope here - no import.
const post = Route.useLoaderData()
</script>

<router lang="ts">
import { createFileRoute, notFound } from '@tanstack/vue-router'
import { getPost } from '@/lib/posts'

export default createFileRoute('/posts/$postId')({
	loader: async ({ params }) => {
		const post = await getPost(params.postId)
		if (!post) throw notFound()
		return post
	}
})
</router>
```

This replaces the `x.ts` + `x.component.vue` pair. Both conventions work in the
same routes directory, so migration can be gradual.

## Setup

```ts
// vite.config.ts
import { tanstackRouterSfc } from 'tanstack-router-sfc'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
	plugins: [...tanstackRouterSfc(), vue()]
})
```

```jsonc
// tsconfig.json - typechecking and IDE support for the block
{
	"vueCompilerOptions": {
		"plugins": ["tanstack-router-sfc/volar"]
	}
}
```

vue-tsc, golar and the VS Code Vue extension all read this entry.

`tanstackRouterSfc` wraps `tanstackRouter` from `@tanstack/router-plugin`, so
it takes the same options (`routesDirectory`, `generatedRouteTree`,
`autoCodeSplitting`, `codeSplittingOptions`, `plugins`, ...) plus `blockType`
(default `'router'`). `target` and `addExtensions` are managed for you.

Peer dependencies: `vite`, `vue`, `@tanstack/router-plugin`,
`@tanstack/vue-router`.

### The route tree

The Vite plugin writes `routeTree.gen.ts` when the dev server or a build
starts, and again when a route file changes. Typecheck and unit tests read it
without Vite, so commit it. A route added without running either fails the
typecheck on its `createFileRoute('...')` path.

The `tanstack-router-sfc` command writes the same file without Vite, with
options from `tsr.config.json` (a CLI cannot see inline Vite options):

```sh
tanstack-router-sfc generate                         # write it; exit 1 on a generator error
tanstack-router-sfc generate --check                 # write it; exit 1 if it was out of date (for CI)
tanstack-router-sfc generate --root apps/platform    # the Vite root, default: the current directory
```

`--check` regenerates the file as well as failing: after a failed check the
tree on disk is the current one, ready to commit.

### knip

knip reads a `.vue` file's `<script>` blocks only, so an export used solely
inside a `<router>` block is reported as unused. Give knip a Vue compiler that
reads the block too (checked against knip 6.45):

```ts
// knip.ts
compilers: {
	vue: (text: string) =>
		[
			...text.matchAll(
				/<(script|router)\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/\1>/g
			)
		]
			.map(([, block, code]) =>
				block === 'router'
					? code.replace('export default ', 'export const Route = ')
					: code
			)
			.join(';\n')
}
```

The route tree imports each block's default export as `Route`; without the
rename knip reports every route file's `default` export as unused. The tag
pattern steps over quoted attributes, because `generic="T extends Foo<any>"`
has a `>` inside the tag. With a custom `blockType`, put its name where
`router` is.

## Rules

- The block must be `<router lang="ts">` and must
  `export default createFileRoute('<path>')({ ... })` - exactly one, with
  a string-literal path. `__root.vue` uses `createRootRoute*` instead.
- A stale path after a rename is **fixed in place** by the generator, the same
  way it fixes `.ts` route files.
- **The block is its own module at runtime.** It shares only `Route` with the
  rest of the file. A value both halves need (a search schema, a constant)
  lives in a third module that each imports. The typechecker enforces most of
  this: the block's own declarations are not visible in `<script setup>`, and
  a `<script setup>` import or top-level declaration used in the block is a
  type error naming `ImportThisInTheRouterBlock`. One gap is left: a value the
  block imports is visible to `<script setup>` in the typechecker, and is a
  `ReferenceError` there at runtime. Import it in `<script setup>` too.
- `Route` is available in `<script setup>` without an import. It is *not*
  available in `<template>`: the typechecker rejects it and it is `undefined`
  in dev (a production build happens to inline it - do not rely on that).
  Assign what the template needs to a `const` in setup.
- An SFC with a `<template>` or `<script setup>` becomes the route's
  `component`, loaded lazily. A block-only `.vue` (redirect or pathless layout)
  gets no component.
- Piece files (`x.component.vue`, `x.errorComponent.vue`, `x.lazy.tsx`, ...)
  and plain `.ts` route files are untouched.
- Every non-piece `.vue` file under the routes directory must have a block.
  Use the `routeFileIgnorePrefix` (`-`) for helper files.

## How it works

Route generation, file watching, formatting and code splitting are the
official `tanstackRouter` plugin's job - this composes it with
`addExtensions: true`, so the generated tree imports `./routes/x.vue` and
TypeScript can see the block's default-exported route as `Route`. On top of that:

1. a **generator plugin** (`afterTransform`) requires every single-file route
   to have a block, keeps its `createFileRoute('...')` id in sync when the file
   moves, and scaffolds an empty `.vue` as an SFC;
2. **`:route-tree`** rewrites the tree's `./routes/x.vue` imports at transform
   time to `x.vue.tsr-router.ts` - the block alone - so the route tree never
   pulls a component into the entry chunk;
3. **`:sfc`** replaces the `<router>` block with a `<script>` shim that imports
   the default-exported route as `Route` from that module, preserving the
   file's line count so template and setup diagnostics stay accurate;
4. **`:router-block`** serves `x.vue.tsr-router.ts`: the block's TypeScript,
   padded to the original line numbers, plus
   `Route.update({ component: lazyRouteComponent(() => import('./x.vue')) })`.

`volar.cjs` splices the block into the SFC's generated TypeScript so vue-tsc,
golar and the VS Code Vue extension typecheck it in place.

### HMR

Editing `<template>` / `<script setup>` / `<style>` hot-updates as usual.
Editing the `<router>` block, or adding or removing a route's only
`<template>`, triggers a full reload. The official plugin swaps a `.ts`
route's options in place, but it does not recognise the block's module yet.

### Code splitting

The route component of a single-file route is split by construction, so you do
not need `autoCodeSplitting` for it. The block itself is not: every block, and
everything it imports, is in the entry chunk, because the route tree imports
it. Keep heavy imports out of blocks, or load them with `import()` inside the
loader. `autoCodeSplitting` is passed through to the official plugin
unchanged, which is what still splits inline `component:` options in `.ts`
route files.

## App kit: `tanstack-router-sfc/app`

Runtime logic for Vue apps on TanStack Router with [Nuxt UI](https://ui.nuxt.com).
It ships no components: the app keeps its design-system shells and wires them
to these. Every function that navigates uses `useRouter()` from the component
it runs in, or takes a `router`.

| Area | Exports |
|---|---|
| Nuxt UI links | `nuxtUiNavigate(router)`; `vueRouterShimOptions(history)` (deprecated) |
| Preloading | `preloadOnIntent(router)`, `useRouterPush().preload` |
| URL search state | `useRouteSearchModels`, `useRouteSearchSync`, `useQueryParam`, `searchFlag` |
| Navigation | `useRouterPush`, `AppPath`, `defineStaticData` |
| Route loading | `trackRouteLoading(router, { hot })`, `routeLoadingMode` |
| Dialogs | `createDialogs` -> `useOpenDialog`, `useConfirmAction`, `useDialogDeepLink`; `useDialogHost`; `formatDialogParam`, `parseDialogParam` |
| Maintenance / API down | `createMaintenanceMode`, `parseApiError` |
| Forms | `formStateFromSchema`, `assignFormState`, `isFormStateEqual`, `getAtPath`, `setAtPath`, `useEntityForm`, `useFormSubmit`, `useSettingsFormSection`, `useFormFieldModel`, `useFieldHighlight`, `useResolvedFormId`, `formStateKey`, `formIdKey`, `formFeedbackKey` |
| Save scope | `provideSaveScope`, `useSaveSection`, `createSaveScope`, `useSaveScopeController`, `useOptionalSaveScopeController` |

`vue-router` (the deprecated shim) and `zod` (`formStateFromSchema` types)
are optional peer dependencies; the kit imports neither at runtime.

### Nuxt UI links

Nuxt UI looks for vue-router unless it is told not to. Turn that off and hand
it TanStack Router's navigation (checked against Nuxt UI 4.10); then `to` on
a Nuxt UI component navigates through TanStack Router. That `to` is a plain
string: for a typed path, use TanStack's `Link`.

```ts
// vite.config.ts
ui({ router: false })
// main.ts
app.use(nuxtUi, { router: nuxtUiNavigate(router) })
```

In this mode a Nuxt UI link is active only when it gets `active`, and its
anchor's `href` is the `to` as written, without the router's basepath.

### Search state

- `useRouteSearchModels(Route)`: writable computeds over the route's typed
  search (`searchModel('tab', 'all')`, `textModel('q')`). The URL is the only
  store; each write is one `replace` navigation.
- `useRouteSearchSync`: for state that lives in another object (a filter
  store). URL changes are written into it, its changes are read back into the
  URL; a change the URL already holds navigates nowhere.
- `useQueryParam(key)`: one param as a string, from anywhere in a component.
- `useRouterPush()`: `router.navigate` with the same typed options, plus
  `newTab`. `push({ to: '/agents/$agentId', params: { agentId }, newTab: true })`.

`AppPath` is the union of paths `navigate({ to })` accepts (`/admin`, not the
`/admin/` full path of its index route).

Every search write is a navigation, and a navigation re-runs each matched
route's `beforeLoad`. So writes made in the same tick go out as one
navigation, and a search box should debounce:
`textModel('q', { debounce: 250 })` holds the typed text and writes the URL
once typing pauses.

### Faster navigation

`defaultPreload: 'intent'` only covers TanStack's `<Link>`. Three things make
the rest of the app load before the click:

```ts
// main.ts - every internal <a href> (Nuxt UI's `to`, markdown) preloads on
// hover, focus or touch. `data-preload="false"` opts an anchor out.
preloadOnIntent(router)
```

```vue
<!-- a row or button that navigates in code -->
<tr @pointerenter="push.preload({ to: '/deals/$dealId', params: { dealId } })"
    @click="push({ to: '/deals/$dealId', params: { dealId } })">
```

```ts
// in the <router> block: start the page's queries with the navigation (or
// the preload), instead of after the page chunk has loaded and mounted.
// Not awaited, so the page still renders at once; `useQuery` picks it up.
export default createFileRoute('/deals/$dealId')({
	loader: ({ context, params }) =>
		void context.queryClient.prefetchQuery(dealQuery(params.dealId))
})
```

### Route loading

```ts
export const routeLoading = trackRouteLoading(router, { hot: import.meta.hot })
// routeLoading.state: 'full' | 'child' | null
```

### Dialogs

```ts
export const { useOpenDialog, useConfirmAction, useDialogDeepLink } = createDialogs({
	dialogs: [
		{ name: 'confirmAction', component: ConfirmAction, data: {} as ConfirmData },
		{
			name: 'dealDetail',
			component: defineAsyncComponent(() => import('./DealDetail.vue')),
			data: {} as { dealId: string },
			hostProps: () => ({ title: t('deals.detail') }),
			// Reopened from a link only with data that parses.
			deepLink: (raw) => DealDetailData.safeParse(raw).data
		},
		{ name: 'dealCreate', component: DealCreate, deepLink: true }
	],
	host: DialogSlideoverHost,
	useOverlay,
	confirm: 'confirmAction'
})
```

- `open(name, data)` resolves with what the dialog closed with. `data` is
  required when the dialog's data has a required key.
- Only a dialog with `deepLink` is written to the URL
  (`?openDialog=dealDetail::{"dealId":"1"}`), so a reload or a shared link
  reopens it. The confirm dialog and a dialog opened from another dialog never
  are. `open(name, data, { trackInUrl: false })` keeps one open out of it.
- Call `useDialogDeepLink()` once in the root component's setup. It waits for
  the first navigation, then opens what the URL names. An unknown name, a
  dialog without `deepLink`, or data its parser rejects opens nothing, clears
  the param and calls `onUnknownDialog`.
- The root route's `validateSearch` must keep the param
  (`openDialog: z.string().optional()`), or a schema strips it.
- `host` is the app's shell. It renders inside the router's context and gets
  `component` (the body), `data` (the body's props) and the definition's
  `hostProps`; it emits `close` with the result. `useDialogHost(props, emit)`
  has its logic.

### Maintenance / API down

```ts
export const maintenance = createMaintenanceMode({
	probe: () => fetch('/api/health', { cache: 'no-store' }),
	// Only when a proxy can also answer 503:
	isMaintenance: async (response) => (await response.json()).message === 'MAINTENANCE_MODE'
})
// in the API client's error handler
maintenance.triggerFromError(error)
```

While active it probes every `retryIntervalSeconds` (15). Only an OK answer
recovers (by default with a reload); a 503 is maintenance; anything else - a
proxy's 502 while the API restarts - or a network error is API down. Point
`probe` at a route that answers OK when healthy.

### Forms

Toasts and translations are the app's: provide them once.

```ts
app.provide(formFeedbackKey, () => {
	const toast = useToast()
	const { t } = useI18n()
	return {
		success: (title) => toast.add({ color: 'success', title }),
		error: (error, title) =>
			toast.add({ color: 'error', title: title ?? t('saveFailed') })
	}
})
```

## Upgrading from 1.x

- **Dialogs are no longer in the URL by default.** Add `deepLink` to each
  dialog that a link should reopen: `true` for one without data, a parser for
  one with data. The confirm dialog and nested dialogs are never mirrored, so
  `trackInUrl: false` on those calls can go. `open(name)` without data no
  longer compiles for a dialog whose data has a required key.
- **`useRouterPush`** takes `router.navigate`'s options:
  `push('/deals/$id', { params, query })` becomes
  `push({ to: '/deals/$id', params, search })`. The positional form still
  works (deprecated), but its `query` now merges into the current search only
  when `to` is the current page.
- **`AppPath`** is the `to` union: `'/admin/'` becomes `'/admin'`.
- **Maintenance mode** recovers only on an OK answer. A `probe` URL that
  answers 404 or 401 when healthy must point at a health route.
- **`vueRouterShimOptions`** is deprecated: switch to `nuxtUiNavigate`.

## Development

```sh
bun run test        # unit tests + a real `vite build` of test/fixture
bun run typecheck
bun run build       # tsdown -> dist/
```

## Releasing

Squash PRs with conventional titles (`fix:`, `feat:`, or `feat!:`). Release Please keeps the version and changelog in a release PR; merge that PR to publish with release notes and npm provenance. See [release and recovery instructions](docs/releasing.md).
