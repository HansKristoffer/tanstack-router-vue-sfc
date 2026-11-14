# Changelog

## [2.1.1](https://github.com/HansKristoffer/tanstack-router-vue-sfc/compare/v2.1.0...v2.1.1) (2026-11-14)


### Bug Fixes

* ship CHANGELOG.md in the npm package ([#14](https://github.com/HansKristoffer/tanstack-router-vue-sfc/issues/14)) ([d66b37c](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/d66b37ccce7ec73c67080e74a252e1e308101164))

## [2.1.0](https://github.com/HansKristoffer/tanstack-router-vue-sfc/compare/v2.0.0...v2.1.0) (2026-11-12)


### Features

* **app:** preload on intent, batched and debounced search writes ([#12](https://github.com/HansKristoffer/tanstack-router-vue-sfc/issues/12)) ([ab860ea](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/ab860ea5b03a0ac431c09b86d179dee2eb320f44))

## [2.0.0](https://github.com/HansKristoffer/tanstack-router-vue-sfc/compare/v1.1.0...v2.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* dialogs are no longer mirrored into the URL by default; add `deepLink` (true, or a parser for the data) to each dialog a link should reopen. The confirm dialog and nested dialogs are never mirrored, and a link reopens a dialog only with data its parser accepts. `useRouterPush` takes router.navigate's typed options; its deprecated positional `query` merges into the current search only on the same page. `AppPath` is the `to` union (`/admin`, not `/admin/`). `open(name)` without data no longer compiles for a dialog whose data has a required key. Maintenance mode recovers only on an OK probe answer.

### Features

* **app:** add nuxtUiNavigate for Nuxt UI's router: false mode and deprecate vueRouterShimOptions ([1e77898](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/1e778981f09088a66b56929e793eec749c170bbf))
* **app:** useRouteSearchModels(Route) and trackRouteLoading(router, { hot }) ([1e77898](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/1e778981f09088a66b56929e793eec749c170bbf))
* **cli:** add tanstack-router-sfc generate and --check ([1e77898](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/1e778981f09088a66b56929e793eec749c170bbf))
* platform review fixes: safe dialog deep links, typed useRouterPush, route tree CLI ([#10](https://github.com/HansKristoffer/tanstack-router-vue-sfc/issues/10)) ([1e77898](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/1e778981f09088a66b56929e793eec749c170bbf))
* **volar:** reject &lt;script setup&gt; names used inside the router block ([1e77898](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/1e778981f09088a66b56929e793eec749c170bbf))


### Bug Fixes

* **app:** maintenance mode treats a proxy's 502 as api-down and recognises a failed fetch in every browser ([1e77898](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/1e778981f09088a66b56929e793eec749c170bbf))
* **app:** useQueryParam reads the parsed search value ([1e77898](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/1e778981f09088a66b56929e793eec749c170bbf))
* **app:** useRouteSearchSync no longer echoes a URL change back after a debounced source ([1e77898](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/1e778981f09088a66b56929e793eec749c170bbf))
* **vite:** reload when a route gains or loses its only template ([1e77898](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/1e778981f09088a66b56929e793eec749c170bbf))

## [1.1.0](https://github.com/HansKristoffer/tanstack-router-vue-sfc/compare/v1.0.2...v1.1.0) (2026-10-20)


### Features

* **app:** add a Vue app kit for TanStack Router + Nuxt UI apps ([a3464f8](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/a3464f8ea39e5e466c57352235def66f6c6715e3))

## [1.0.2](https://github.com/HansKristoffer/tanstack-router-vue-sfc/compare/v1.0.1...v1.0.2) (2026-10-20)


### Bug Fixes

* **volar:** scope the router block apart from &lt;script setup&gt; ([#5](https://github.com/HansKristoffer/tanstack-router-vue-sfc/issues/5)) ([de61d92](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/de61d92ef7243d3f1e9df1d72705026bff5e998a))

## [1.0.1](https://github.com/HansKristoffer/tanstack-router-vue-sfc/compare/v1.0.0...v1.0.1) (2026-09-13)


### Bug Fixes

* correct peer ranges, harden HMR and block parsing, add test coverage ([2f9b535](https://github.com/HansKristoffer/tanstack-router-vue-sfc/commit/2f9b5354ed5e32122b33202bf674b8ebbbb748f4))
