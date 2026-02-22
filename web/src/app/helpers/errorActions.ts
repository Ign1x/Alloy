import { isAlloyApiError } from '../../rspc'

export type ErrorActionType = 'retry' | 'open-settings'

export function shouldOfferSettingsAction(error: unknown): boolean {
  if (!isAlloyApiError(error)) return false
  const code = (error.data.code || '').toLowerCase()
  return code === 'permission_denied' || code === 'forbidden' || code === 'agent_unreachable' || code === 'invalid_param'
}

export function suggestedErrorActions(error: unknown, hasRetry: boolean, hasOpenSettings: boolean): ErrorActionType[] {
  const actions: ErrorActionType[] = []
  if (hasRetry) actions.push('retry')
  if (hasOpenSettings && shouldOfferSettingsAction(error)) actions.push('open-settings')
  return actions
}
