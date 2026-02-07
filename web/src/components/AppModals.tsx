import type { ComponentProps } from 'solid-js'

import AddNodeModal from './AddNodeModal'
import ControlDiagnosticsModal from './ControlDiagnosticsModal'
import DeleteInstanceModal from './DeleteInstanceModal'
import DownloadTaskModal from './DownloadTaskModal'
import EditInstanceModal from './EditInstanceModal'
import FrpNodeModal from './FrpNodeModal'
import InstanceDetailsModal from './InstanceDetailsModal'
import LoginModal from './LoginModal'
import ToastPortal from './ToastPortal'

interface AppModalsProps {
  downloadTaskModalProps: ComponentProps<typeof DownloadTaskModal>
  loginModalProps: ComponentProps<typeof LoginModal>
  addNodeModalProps: ComponentProps<typeof AddNodeModal>
  frpNodeModalProps: ComponentProps<typeof FrpNodeModal>
  deleteInstanceModalProps: ComponentProps<typeof DeleteInstanceModal>
  editInstanceModalProps: ComponentProps<typeof EditInstanceModal>
  controlDiagnosticsModalProps: ComponentProps<typeof ControlDiagnosticsModal>
  instanceDetailsModalProps: ComponentProps<typeof InstanceDetailsModal>
  toastPortalProps: ComponentProps<typeof ToastPortal>
}

export default function AppModals(props: AppModalsProps) {
  return (
    <>
      <DownloadTaskModal {...props.downloadTaskModalProps} />
      <LoginModal {...props.loginModalProps} />
      <AddNodeModal {...props.addNodeModalProps} />
      <FrpNodeModal {...props.frpNodeModalProps} />
      <DeleteInstanceModal {...props.deleteInstanceModalProps} />
      <EditInstanceModal {...props.editInstanceModalProps} />
      <ControlDiagnosticsModal {...props.controlDiagnosticsModalProps} />
      <InstanceDetailsModal {...props.instanceDetailsModalProps} />
      <ToastPortal {...props.toastPortalProps} />
    </>
  )
}
