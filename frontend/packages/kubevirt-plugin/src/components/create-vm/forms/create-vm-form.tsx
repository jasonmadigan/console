import * as React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { uniqueNamesGenerator, animals, adjectives } from 'unique-names-generator';
import {
  Alert,
  Form,
  TextInput,
  Checkbox,
  SelectVariant,
  SelectOption,
  Split,
  SplitItem,
  Stack,
  StackItem,
  ExpandableSection,
} from '@patternfly/react-core';
import {
  convertToBaseValue,
  LoadingBox,
  useAccessReview2,
} from '@console/internal/components/utils';
import { useK8sWatchResource } from '@console/internal/components/utils/k8s-watch-hook';
import { alignWithDNS1123, BlueInfoCircleIcon, FLAGS, useFlag } from '@console/shared';
import { TemplateKind } from '@console/internal/module/k8s';

import { DataVolumeModel, VirtualMachineModel } from '../../../models';
import { VMKind } from '../../../types';
import { validateVmLikeEntityName } from '../../../utils/validations';
import { VIRTUAL_MACHINE_EXISTS } from '../../../utils/validations/strings';
import { FormRow } from '../../form/form-row';
import { ProjectDropdown } from '../../form/project-dropdown';
import { getTemplateName, selectVM } from '../../../selectors/vm-template/basic';
import {
  getDefaultDiskBus,
  getTemplateFlavorDesc,
  getTemplateMemory,
  getTemplateSizeRequirement,
} from '../../../selectors/vm-template/advanced';
import { VMSettingsField } from '../../create-vm-wizard/types';
import { helpResolver } from '../../create-vm-wizard/strings/renderable-field';
import { FormAction, FormState, FORM_ACTION_TYPE } from './create-vm-form-reducer';
import { TemplateItem } from '../../../types/template';
import { isTemplateSourceError, TemplateSourceStatus } from '../../../statuses/template/types';
import {
  SourceDescription,
  URLSource,
  ContainerSource,
  PVCSource,
} from '../../vm-templates/vm-template-source';
import { BootSourceState } from './boot-source-form-reducer';
import { ROOT_DISK_INSTALL_NAME } from '../../../constants';
import { getCPU, getWorkloadProfile, vCPUCount } from '../../../selectors/vm';
import { FormPFSelect } from '../../form/form-pf-select';
import { preventDefault } from '../../form/utils';
import { getParameterValue } from '../../../selectors/selectors';
import { DataVolumeSourceType, TEMPLATE_BASE_IMAGE_NAME_PARAMETER } from '../../../constants/vm';

import './create-vm-form.scss';

const generateName = (template: TemplateKind): string =>
  alignWithDNS1123(
    `${getParameterValue(template, TEMPLATE_BASE_IMAGE_NAME_PARAMETER) ||
      getTemplateName(template)}-${uniqueNamesGenerator({
      dictionaries: [adjectives, animals],
      separator: '-',
    })}`,
  );

export type CreateVMFormProps = {
  template: TemplateItem;
  sourceStatus: TemplateSourceStatus;
  customSource?: BootSourceState;
  state: FormState;
  dispatch: React.Dispatch<FormAction>;
};

export const CreateVMForm: React.FC<CreateVMFormProps> = ({
  sourceStatus,
  template: selectedTemplate,
  state,
  dispatch,
  customSource,
}) => {
  const { t } = useTranslation();
  const { name, nameValidation, namespace, startVM, template } = state;
  const [vms, loaded] = useK8sWatchResource<VMKind[]>({
    kind: VirtualMachineModel.kind,
    namespace,
    isList: true,
  });

  const [cloneAllowed, cloneAllowedLoading] = useAccessReview2({
    group: DataVolumeModel.apiGroup,
    resource: DataVolumeModel.plural,
    subresource: 'source',
    verb: 'create',
    namespace,
  });

  const useProjects = useFlag(FLAGS.OPENSHIFT);

  React.useEffect(() => {
    if (!template) {
      dispatch({ type: FORM_ACTION_TYPE.SET_TEMPLATE, payload: selectedTemplate.variants[0] });
    }
  }, [dispatch, selectedTemplate.variants, template]);

  const onNameChange = (value: string) => {
    const validation = validateVmLikeEntityName(value, namespace, vms, {
      existsErrorMessage: VIRTUAL_MACHINE_EXISTS,
      subject: 'Name',
    });
    dispatch({ type: FORM_ACTION_TYPE.SET_NAME, payload: { value, validation } });
  };

  const onNamespaceChange = (value: string) => {
    const validation = validateVmLikeEntityName(value, namespace, vms, {
      existsErrorMessage: VIRTUAL_MACHINE_EXISTS,
      subject: 'Name',
    });
    dispatch({ type: FORM_ACTION_TYPE.SET_NAMESPACE, payload: { value, validation } });
  };

  React.useEffect(() => {
    if (loaded && namespace && !name && template) {
      const initName = generateName(template);
      onNameChange(initName);
    }
    // eslint-disable-next-line
  }, [loaded]);

  if (cloneAllowedLoading) {
    return <LoadingBox />;
  }

  if (!cloneAllowed && namespace) {
    return (
      <Alert variant="danger" isInline title={t('kubevirt-plugin~Permissions required')}>
        {t('kubevirt-plugin~You do not have permissions to clone base image into this namespace.')}
      </Alert>
    );
  }

  if (cloneAllowed !== state.cloneAllowed) {
    dispatch({ type: FORM_ACTION_TYPE.CLONE_ALLOWED, payload: cloneAllowed });
  }

  const flavors = selectedTemplate.variants
    .sort((a, b) => {
      const aCPU = vCPUCount(getCPU(selectVM(a)));
      const bCPU = vCPUCount(getCPU(selectVM(b)));
      if (aCPU === bCPU) {
        const aMemory = convertToBaseValue(getTemplateMemory(a));
        const bMemory = convertToBaseValue(getTemplateMemory(b));
        return aMemory - bMemory;
      }
      return aCPU - bCPU;
    })
    .reduce((acc, tmp) => {
      const flavor = getTemplateFlavorDesc(tmp);
      acc[flavor] = tmp;
      return acc;
    }, {});

  let source: React.ReactNode;
  let cdRom = false;
  if (customSource?.dataSource) {
    cdRom = customSource.cdRom?.value;
    switch (DataVolumeSourceType.fromString(customSource.dataSource?.value)) {
      case DataVolumeSourceType.HTTP:
        source = <URLSource url={customSource.url?.value} isCDRom={cdRom} />;
        break;
      case DataVolumeSourceType.REGISTRY:
        source = <ContainerSource container={customSource.container?.value} isCDRom={cdRom} />;
        break;
      case DataVolumeSourceType.PVC:
        source = (
          <PVCSource
            name={customSource.pvcName?.value}
            namespace={customSource.pvcNamespace?.value}
            isCDRom={cdRom}
            clone
          />
        );
        break;
      default:
        break;
    }
  } else if (!isTemplateSourceError(sourceStatus)) {
    cdRom = sourceStatus.isCDRom;
    source = (
      <SourceDescription sourceStatus={sourceStatus} template={selectedTemplate.variants[0]} />
    );
  }

  return (
    <Stack hasGutter>
      <StackItem>
        <Trans t={t} ns="kubevirt-plugin">
          You are creating a virtual machine from the <b>{getTemplateName(template)}</b> template.
        </Trans>
      </StackItem>
      <StackItem>
        <Form onSubmit={preventDefault}>
          <FormRow
            fieldId="vm-namespace"
            title={useProjects ? t('kubevirt-plugin~Project') : t('kubevirt-plugin~Namespace')}
            isRequired
          >
            <ProjectDropdown onChange={onNamespaceChange} project={namespace} />
          </FormRow>
          <FormRow
            fieldId="vm-name"
            title={t('kubevirt-plugin~Virtual Machine Name')}
            isRequired
            validation={nameValidation}
            help={t('kubevirt-plugin~The name field is auto generated for quick create.')}
          >
            <TextInput
              isRequired
              type="text"
              id="vm-name"
              name="vm-name"
              aria-describedby="vm-name-helper"
              value={name}
              onChange={onNameChange}
              isDisabled={!namespace || !loaded}
            />
          </FormRow>
          <FormRow fieldId="vm-flavor" title={t('kubevirt-plugin~Flavor')} isRequired>
            <FormPFSelect
              variant={SelectVariant.single}
              selections={[getTemplateFlavorDesc(template)]}
              onSelect={(e, f: string) =>
                dispatch({ type: FORM_ACTION_TYPE.SET_TEMPLATE, payload: flavors[f] })
              }
              isCheckboxSelectionBadgeHidden
            >
              {Object.keys(flavors).map((flavor) => (
                <SelectOption key={flavor} value={flavor} />
              ))}
            </FormPFSelect>
          </FormRow>
          <Split hasGutter className="kubevirt-create-vm-desc">
            <SplitItem>
              <FormRow fieldId="vm-storage" title={t('kubevirt-plugin~Storage')}>
                {getTemplateSizeRequirement(template, sourceStatus, customSource)}
              </FormRow>
            </SplitItem>
            <SplitItem>
              <FormRow
                fieldId="vm-workload"
                title={t('kubevirt-plugin~Workload profile')}
                help={helpResolver[VMSettingsField.WORKLOAD_PROFILE]()}
              >
                {getWorkloadProfile(template) || t('kubevirt-plugin~Not available')}
              </FormRow>
            </SplitItem>
          </Split>
          {source && (
            <FormRow fieldId="boot-source" title={t('kubevirt-plugin~Boot source')}>
              <Stack hasGutter>
                <StackItem>{source}</StackItem>
                {cdRom && (
                  <StackItem>
                    <Stack>
                      <StackItem>
                        <BlueInfoCircleIcon className="co-icon-space-r" />
                        {t(
                          'kubevirt-plugin~A new disk has been added to support this ISO source. Edit this disk by customizing the virtual machine.',
                        )}
                      </StackItem>
                      <StackItem>
                        <ExpandableSection toggleText={t('kubevirt-plugin~Disk details')}>
                          {ROOT_DISK_INSTALL_NAME} - {t('kubevirt-plugin~Blank')} - 20GiB -{' '}
                          {getDefaultDiskBus(template).toString()} -{' '}
                          {t('kubevirt-plugin~default Storage class')}
                        </ExpandableSection>
                      </StackItem>
                    </Stack>
                  </StackItem>
                )}
              </Stack>
            </FormRow>
          )}
          <FormRow fieldId="start-vm">
            <Checkbox
              isChecked={startVM}
              onChange={(value) => dispatch({ type: FORM_ACTION_TYPE.START_VM, payload: value })}
              label={t('kubevirt-plugin~Start this virtual machine after creation')}
              id="start-vm"
            />
          </FormRow>
        </Form>
      </StackItem>
    </Stack>
  );
};
