/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ReactWrapper } from 'enzyme';
import { mount } from 'enzyme';
import React from 'react';

import {
  mockGlobalState,
  SUB_PLUGINS_REDUCER,
  kibanaObservable,
  createSecuritySolutionStorageMock,
  TestProviders,
} from '../../../../common/mock';
import type { State } from '../../../../common/store';
import { createStore } from '../../../../common/store';
import { useKibana } from '../../../../common/lib/kibana';
import { NewTemplateTimeline } from './new_template_timeline';

jest.mock('../../../../common/lib/kibana', () => {
  return {
    useKibana: jest.fn(),
  };
});

describe('NewTemplateTimeline', () => {
  const state: State = mockGlobalState;
  const { storage } = createSecuritySolutionStorageMock();
  const store = createStore(state, SUB_PLUGINS_REDUCER, kibanaObservable, storage);
  const mockClosePopover = jest.fn();
  const mockTitle = 'NEW_TIMELINE';
  let wrapper: ReactWrapper;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('render if CRUD', () => {
    beforeAll(() => {
      (useKibana as jest.Mock).mockReturnValue({
        services: {
          application: {
            capabilities: {
              siem: {
                crud: true,
              },
            },
          },
        },
      });

      wrapper = mount(
        <TestProviders store={store}>
          <NewTemplateTimeline outline={true} onClick={mockClosePopover} title={mockTitle} />
        </TestProviders>
      );
    });

    test('render with iconType', () => {
      expect(
        wrapper
          .find('[data-test-subj="template-timeline-new-with-border"]')
          .first()
          .prop('iconType')
      ).toEqual('plusInCircle');
    });

    test('render with onClick', () => {
      expect(
        wrapper.find('[data-test-subj="template-timeline-new-with-border"]').first().prop('onClick')
      ).toBeTruthy();
    });
  });

  describe('If no CRUD', () => {
    beforeAll(() => {
      (useKibana as jest.Mock).mockReturnValue({
        services: {
          application: {
            capabilities: {
              siem: {
                crud: false,
              },
            },
          },
        },
      });

      wrapper = mount(
        <TestProviders store={store}>
          <NewTemplateTimeline outline={true} onClick={mockClosePopover} title={mockTitle} />
        </TestProviders>
      );
    });

    test('render', () => {
      expect(
        wrapper.find('[data-test-subj="template-timeline-new-with-border"]').exists()
      ).toBeTruthy();
    });
  });
});
