# tanstack-router-sfc

TanStack Router for Vue with single-file routes, published to npm as `tanstack-router-sfc` (the repository is `tanstack-router-vue-sfc`): a Vite plugin, a Volar plugin and a `generate` CLI for the `<router lang="ts">` block, plus an app kit at `tanstack-router-sfc/app`. The [README](README.md) is the user guide and ships in the package: it is all an app's agent gets, so a change in behavior updates it in the same PR, at the place that describes it.

## Consumers

Only our own apps install it. A breaking change is allowed when it is released as one: title the PR `feat!:`, also for a type-only break, and add what an app must change to the README's upgrading section. The apps are upgraded after the release.

## Before a PR

```sh
bun run lint && bun test && bun run build && bun run verify:package
```

This is what CI runs, and CI runs `bun test` once more against the lowest peer versions (`test-lowest-peers` in [ci.yml](.github/workflows/ci.yml)): a generator hook newer than `@tanstack/router-plugin` 1.140.0 fails there.

## The block is read in three places

`src/sfc.ts` reads the `<router>` block for Vite and the CLI, `volar.cjs` for the typechecker, and the README's knip compiler for knip. `volar.cjs` ships as written, CommonJS, outside the build, so it shares no code with `src/`. A change to what a block may contain goes into all three.

## Releasing

The PR title decides the release, and CI rejects a title that is not a conventional commit. Release Please writes the version in `package.json` and `CHANGELOG.md` in its release PR: leave both to it. See [docs/releasing.md](docs/releasing.md).
