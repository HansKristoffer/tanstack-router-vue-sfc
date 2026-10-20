import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: { vite: 'src/vite.ts', app: 'src/app/index.ts' },
	format: ['esm'],
	dts: true,
	clean: true,
	// Everything the package talks to is a peer dependency of the host app.
	deps: {
		neverBundle: [
			'vite',
			'vue',
			'vue/compiler-sfc',
			'vue-router',
			'zod',
			'@tanstack/router-plugin',
			'@tanstack/router-plugin/vite',
			'@tanstack/vue-router'
		]
	}
})
