import { createApp, h } from 'vue'
import { RouterProvider, createRouter } from '@tanstack/vue-router'
import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })
createApp({ render: () => h(RouterProvider, { router }) }).mount('#app')

declare module '@tanstack/vue-router' {
	interface Register {
		router: typeof router
	}
}
