import * as React from 'react';
import { useModal } from '@console/dynamic-plugin-sdk/src/app/modal-support/useModal';
import {
  CreateProjectModal,
  CreateProjectModalProps,
} from '../components/modals/CreateProjectModal';

export const useCreateProjectModal: UseCreateProjectModal = () => {
  const launcher = useModal();
  return React.useCallback((props) => launcher(CreateProjectModal, props), [launcher]);
};

type UseCreateProjectModal = () => (props: CreateProjectModalProps) => void;
