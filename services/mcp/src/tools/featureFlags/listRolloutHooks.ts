import type { ToolHooks } from '@/tools/tool-hooks'

import { withRolloutSummaries } from './rolloutSummary'

/** feature-flag-get-all: each row's `filters` becomes a one-line `rollout` summary. */
export default {
    afterResponse: (_context, _params, result) => withRolloutSummaries(result),
} satisfies ToolHooks<unknown>
