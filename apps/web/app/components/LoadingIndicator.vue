<script setup lang="ts">
/** Accessible Element Plus loading indicator shared by asynchronous views. */

import { Loading } from "@element-plus/icons-vue";
</script>

<template>
  <ElIcon class="is-loading" role="status" aria-label="読み込み中">
    <Loading />
  </ElIcon>
</template>
