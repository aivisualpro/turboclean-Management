<script setup lang="ts">
defineProps<{
  title: string
  data: { name?: string; value: any; color?: string }[]
  rawData?: Record<string, any>
}>()

function fmtDollar(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
</script>

<template>
  <div style="background: var(--background, #fff); border: 1px solid var(--border, #e5e7eb); border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.12); padding: 14px 16px; min-width: 250px; font-family: Inter, system-ui, sans-serif;">
    <!-- Month Title -->
    <div style="font-size: 15px; font-weight: 700; color: var(--foreground, #111); margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border, #e5e7eb);">
      {{ title }}
    </div>

    <!-- Revenue -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <div style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;" />
        <span style="font-size: 12px; color: var(--muted-foreground, #6b7280);">Revenue</span>
      </div>
      <span style="font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--foreground, #111);">{{ rawData ? fmtDollar(rawData.revenue) : '' }}</span>
    </div>

    <!-- Work Orders -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <div style="width: 8px; height: 8px; border-radius: 50%; background: #3b82f6;" />
        <span style="font-size: 12px; color: var(--muted-foreground, #6b7280);">Work Orders</span>
      </div>
      <span style="font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--foreground, #111);">{{ rawData?.orders?.toLocaleString() }}</span>
    </div>

    <!-- Avg Order -->
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <div style="width: 8px; height: 8px; border-radius: 50%; background: #8b5cf6;" />
        <span style="font-size: 12px; color: var(--muted-foreground, #6b7280);">Avg. Order</span>
      </div>
      <span style="font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--foreground, #111);">{{ rawData ? fmtDollar(rawData.avgOrder) : '' }}</span>
    </div>

    <!-- Top 5 Dealers -->
    <div v-if="rawData?.topDealers?.length" style="border-top: 1px solid var(--border, #e5e7eb); padding-top: 8px;">
      <div style="font-size: 11px; font-weight: 600; color: var(--muted-foreground, #6b7280); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;">
        Top 5 Dealers
      </div>
      <div v-for="(dealer, idx) in rawData.topDealers" :key="idx" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
        <div style="display: flex; align-items: center; gap: 5px;">
          <span style="font-size: 10px; font-weight: 700; color: var(--muted-foreground, #9ca3af); min-width: 14px;">{{ Number(idx) + 1 }}.</span>
          <span style="font-size: 12px; color: var(--foreground, #111); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ dealer.name }}</span>
        </div>
        <span style="font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--foreground, #111);">{{ fmtDollar(dealer.revenue) }}</span>
      </div>
    </div>
  </div>
</template>
