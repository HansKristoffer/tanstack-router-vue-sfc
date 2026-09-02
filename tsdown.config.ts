import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: ['src/vite.ts'],
	format: ['esm'],
	dts: true,
	clean: true,
	// Everything the plugin talks to is a peer dependency of the host app.
	deps: {
		neverBundle: [
			'vite',
			'vue',
			'vue/compiler-sfc',
			'@tanstack/router-plugin',
			'@tanstack/router-plugin/vite',
			'@tanstack/vue-router'
		]
	}
})
