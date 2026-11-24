<script setup lang="ts">
export interface TableColumn {
  key: string
  label: string
}

const props = withDefaults(defineProps<{
  caption: string
  columns: TableColumn[]
  rows: Record<string, unknown>[]
}>(), {})

function plain(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Unavailable'
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return String(value)
  return 'Unavailable'
}
</script>

<template>
  <div class="mm-table-wrap">
    <table class="mm-table">
      <caption class="sr-only">{{ props.caption }}</caption>
      <thead>
        <tr>
          <th v-for="column in props.columns" :key="column.key" scope="col">{{ column.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in props.rows" :key="String(row.id ?? row.bookingId ?? row.reference ?? index)">
          <td v-for="column in props.columns" :key="column.key">
            <slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]">
              {{ plain(row[column.key]) }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
