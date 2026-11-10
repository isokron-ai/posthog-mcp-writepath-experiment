/**
 * Atomic-write and batch tools. The patterns they share are written up in
 * services/mcp/docs/atomic-and-batch-tools.md:
 *
 * - batch.ts: validate every item, then write best-effort with a result per item (and dry_run)
 * - compensation.ts: compensating rollback for a multi-step create
 * - versionGuard.ts: version-checked read-merge-write for partial updates
 */
import type { ToolBase, ZodObjectAny } from '@/tools/types'

import { annotationsBatchCreateTool, annotationsBatchDeleteTool } from './annotationsBatch'
import dashboardCreateWithInsights from './dashboardCreateWithInsights'
import insightsBatchUpdate from './insightsBatchUpdate'

export const ATOMIC_TOOLS: Record<string, () => ToolBase<ZodObjectAny>> = {
    'insights-batch-update': insightsBatchUpdate,
    'annotations-batch-create': annotationsBatchCreateTool,
    'annotations-batch-delete': annotationsBatchDeleteTool,
    'dashboard-create-with-insights': dashboardCreateWithInsights,
}
