<template>
	<h1 class="fixture-index-marker">{{ data }}</h1>
</template>

<script setup lang="ts">
const data = Route.useLoaderData()
</script>

<router lang="ts">
import { createFileRoute } from '@tanstack/vue-router'

export default createFileRoute('/')({
	loader: () => 'FIXTURE_INDEX_LOADER'
})
</router>
