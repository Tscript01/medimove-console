<template>
  <div>
    <!-- Registers the PWA web manifest (Nuxt PWA module docs). -->
    <VitePwaManifest />
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
