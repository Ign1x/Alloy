import type { ProcessStatusDto } from '../../bindings'
import type { I18nTranslate } from '../i18n'
import { canStartInstance, isStopping } from './instances'

type InstanceReasonInput = {
  status: ProcessStatusDto | null
  isReadOnly: boolean
  operationInProgress: boolean
  t: I18nTranslate
}

type InstanceDangerReasonInput = {
  status: ProcessStatusDto | null
  isReadOnly: boolean
  t: I18nTranslate
}

export function startInstanceActionTitle(input: InstanceReasonInput): string {
  if (input.isReadOnly) return input.t('header.readOnlyMode')
  if (input.operationInProgress) return input.t('instances.actions.operationInProgress')
  return input.t('instances.actions.start')
}

export function stopInstanceActionTitle(input: InstanceReasonInput): string {
  if (input.isReadOnly) return input.t('header.readOnlyMode')
  if (isStopping(input.status)) return input.t('instances.actions.stoppingInProgress')
  if (input.operationInProgress) return input.t('instances.actions.operationInProgress')
  return input.t('instances.actions.stop')
}

export function restartInstanceActionTitle(input: InstanceReasonInput): string {
  if (input.isReadOnly) return input.t('header.readOnlyMode')
  if (isStopping(input.status)) return input.t('instances.actions.stoppingInProgress')
  if (input.operationInProgress) return input.t('instances.actions.operationInProgress')
  return input.t('instances.actions.restart')
}

export function canEditOrDeleteInstance(status: ProcessStatusDto | null, isReadOnly: boolean): boolean {
  return !isReadOnly && canStartInstance(status)
}

export function editInstanceActionTitle(input: InstanceDangerReasonInput): string {
  if (input.isReadOnly) return input.t('header.readOnlyMode')
  if (!canStartInstance(input.status)) return input.t('instances.actions.stopBeforeEdit')
  return input.t('instances.actions.editParams')
}

export function deleteInstanceActionTitle(input: InstanceDangerReasonInput): string {
  if (input.isReadOnly) return input.t('header.readOnlyMode')
  if (!canStartInstance(input.status)) return input.t('instances.actions.stopBeforeDelete')
  return input.t('instances.actions.deleteInstance')
}
