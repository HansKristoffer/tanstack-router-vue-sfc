<template>
	<Outlet />
</template>

<script setup lang="ts">
import { Outlet } from '@tanstack/vue-router'
</script>

<router lang="ts">
import { createRootRoute } from '@tanstack/vue-router'

export default createRootRoute({})
</router>
