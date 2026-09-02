<template>
	<h1 class="fixture-about-marker">about</h1>
</template>

<router lang="ts">
import { createFileRoute } from '@tanstack/vue-router'

export default createFileRoute('/about')({
	validateSearch: (search: Record<string, unknown>) => ({
		q: typeof search.q === 'string' ? search.q : undefined
	})
})
</router>
