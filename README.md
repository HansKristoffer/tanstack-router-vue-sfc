# @lullu/tanstack-router-sfc

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

export const Route = createFileRoute('/posts/$postId')({
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
import { tanstackRouterSfc } from '@lullu/tanstack-router-sfc'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
	plugins: [...tanstackRouterSfc(), vue()]
})
```

```jsonc
// tsconfig.json - typechecking and IDE support for the block
{
	"vueCompilerOptions": {
		"plugins": ["@lullu/tanstack-router-sfc/volar"]
	}
}
```

`tanstackRouterSfc` wraps `tanstackRouter` from `@tanstack/router-plugin`, so
it takes the same options (`routesDirectory`, `generatedRouteTree`,
`autoCodeSplitting`, `codeSplittingOptions`, `plugins`, ...) plus `blockType`
(default `'router'`). `target` and `addExtensions` are managed for you.

Peer dependencies: `vite`, `vue`, `@tanstack/router-plugin`,
`@tanstack/vue-router`.

## Rules

- The block must be `<router lang="ts">` and must
  `export const Route = createFileRoute('<path>')({ ... })` - exactly one, with
  a string-literal path. `__root.vue` uses `createRootRoute*` instead.
- A stale path after a rename is **fixed in place** by the generator, the same
  way it fixes `.ts` route files.
- `Route` is available in `<script setup>` without an import. It is *not*
  available in `<template>` (it is a `<script>` binding, like any plain
  `<script>` value) - assign it to a `const` in setup if the template needs it.
- An SFC with a `<template>` or `<script setup>` becomes the route's
  `component`, loaded lazily. A block-only `.vue` (redirect or pathless layout)
  gets no component.
- Piece files (`x.component.vue`, `x.errorComponent.vue`, `x.lazy.tsx`, ...)
  and plain `.ts` route files are untouched.
- Every non-piece `.vue` file under the routes directory must have a block.
  Use the `routeFileIgnorePrefix` (`-`) for helper files.

## How it works

Route generation, file watching, formatting, code splitting and route HMR are
the official `tanstackRouter` plugin's job - this composes it with
`addExtensions: true`, so the generated tree imports `./routes/x.vue` and
TypeScript can see the `Route` the block exports. On top of that:

1. a **generator plugin** (`afterTransform`) requires every single-file route
   to have a block, keeps its `createFileRoute('...')` id in sync when the file
   moves, and scaffolds an empty `.vue` as an SFC;
2. **`:route-tree`** rewrites the tree's `./routes/x.vue` imports at transform
   time to `x.vue.tsr-router.ts` - the block alone - so the route tree never
   pulls a component into the entry chunk;
3. **`:sfc`** replaces the `<router>` block with a `<script>` shim re-exporting
   `Route` from that module, preserving the file's line count so template and
   setup diagnostics stay accurate;
4. **`:router-block`** serves `x.vue.tsr-router.ts`: the block's TypeScript,
   padded to the original line numbers, plus
   `Route.update({ component: lazyRouteComponent(() => import('./x.vue')) })`.

`volar.cjs` splices the block into the SFC's generated TypeScript so `vue-tsc`
(and golar, and the VS Code Vue extension) typecheck it in place.

### HMR

Editing `<template>` / `<script setup>` / `<style>` hot-updates as usual.
Editing the `<router>` block triggers a full reload - the router is built once
at startup, so a changed route definition cannot be swapped in place.

### Note on `autoCodeSplitting`

Single-file routes are split by construction, so you do not need it for them.
It is passed through to the official plugin unchanged, which is what still
splits inline `component:` options in `.ts` route files.

## Development

```sh
bun run test        # unit tests + a real `vite build` of test/fixture
bun run typecheck
bun run build       # tsdown -> dist/
```

`npm pack` builds and swaps the entry points to `dist/` (see
`scripts/pack-fields.ts`); the working tree keeps pointing at the TypeScript
source.
