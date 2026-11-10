import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { GENERATED_TOOL_MAP } from '@/tools/generated'
import type { Context } from '@/tools/types'

const coreDefinitions = parseYaml(fs.readFileSync(path.resolve(__dirname, '../../definitions/core.yaml'), 'utf-8'))

// Shaped like the body PATCH /api/users/@me/ returns: the whole user, with the current
// project and every organization project nested inside it.
const USER = {
    id: 1,
    uuid: '0190a1b2-0000-7000-8000-000000000001',
    email: 'user@example.com',
    theme_mode: 'dark',
    is_impersonated: false,
    sensitive_session_expires_at: '2026-01-01T00:00:00Z',
    team: { id: 2, name: 'Project', api_token: 'phc_project_token' },
    organization: { id: 'org-1', name: 'Org', teams: [{ id: 2, name: 'Project', api_token: 'phc_project_token' }] },
    organizations: [{ id: 'org-1', name: 'Org', slug: 'org' }],
}

describe('user-settings-update response', () => {
    // `user-get` trims the nested organization and project objects, and `project-get` is
    // documented as the one tool that returns the project API token. The update tool
    // returned the raw PATCH body, so it gave back what the read tool leaves out.
    it('returns the same trimmed profile as user-get', async () => {
        const context = { api: { request: vi.fn().mockResolvedValue(USER) }, stateManager: {} } as unknown as Context

        const read = await GENERATED_TOOL_MAP['user-get']!().handler(context, { uuid: '@me' })
        const updated = await GENERATED_TOOL_MAP['user-settings-update']!().handler(context, {
            uuid: '@me',
            theme_mode: 'dark',
        })

        expect(updated).toEqual(read)
        expect(updated).toMatchObject({ theme_mode: 'dark', team: { id: 2, name: 'Project' } })
        expect(JSON.stringify(updated)).not.toContain('phc_project_token')
        expect(updated).not.toHaveProperty('is_impersonated')
    })

    it('declares the same response fields as user-get', () => {
        expect(coreDefinitions.tools['user-settings-update'].response).toEqual(
            coreDefinitions.tools['user-get'].response
        )
    })
})
