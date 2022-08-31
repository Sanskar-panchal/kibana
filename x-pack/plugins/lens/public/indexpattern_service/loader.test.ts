/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { HttpHandler } from '@kbn/core/public';
import { last } from 'lodash';
import { DataViewsContract } from '@kbn/data-views-plugin/public';
import { createHttpFetchError } from '@kbn/core-http-browser-mocks';
import { IndexPattern, IndexPatternField } from '../types';
import {
  ensureIndexPattern,
  loadIndexPatternRefs,
  loadIndexPatterns,
  syncExistingFields,
} from './loader';
import { sampleIndexPatterns, mockDataViewsService } from './mocks';
import { documentField } from '../indexpattern_datasource/document_field';

describe('loader', () => {
  describe('loadIndexPatternRefs', () => {
    it('should return a list of sorted indexpattern refs', async () => {
      const refs = await loadIndexPatternRefs(mockDataViewsService());
      expect(refs[0].title < refs[1].title).toBeTruthy();
    });
  });

  describe('loadIndexPatterns', () => {
    it('should not load index patterns that are already loaded', async () => {
      const dataViewsService = mockDataViewsService();
      dataViewsService.get = jest.fn(() =>
        Promise.reject('mockIndexPatternService.get should not have been called')
      );

      const cache = await loadIndexPatterns({
        cache: sampleIndexPatterns,
        patterns: ['1', '2'],
        dataViews: dataViewsService,
      });

      expect(cache).toEqual(sampleIndexPatterns);
    });

    it('should load index patterns that are not loaded', async () => {
      const cache = await loadIndexPatterns({
        cache: {
          '2': sampleIndexPatterns['2'],
        },
        patterns: ['1', '2'],
        dataViews: mockDataViewsService(),
      });

      expect(Object.keys(cache)).toEqual(['1', '2']);
    });

    it('should apply field restrictions from typeMeta', async () => {
      const cache = await loadIndexPatterns({
        cache: {},
        patterns: ['foo'],
        dataViews: {
          get: jest.fn(async () => ({
            id: 'foo',
            title: 'Foo index',
            metaFields: [],
            isPersisted: () => true,
            typeMeta: {
              aggs: {
                date_histogram: {
                  timestamp: {
                    agg: 'date_histogram',
                    fixed_interval: 'm',
                  },
                },
                sum: {
                  bytes: {
                    agg: 'sum',
                  },
                },
              },
            },
            fields: [
              {
                name: 'timestamp',
                displayName: 'timestampLabel',
                type: 'date',
                aggregatable: true,
                searchable: true,
              },
              {
                name: 'bytes',
                displayName: 'bytes',
                type: 'number',
                aggregatable: true,
                searchable: true,
              },
            ],
          })),
          getIdsWithTitle: jest.fn(async () => ({
            id: 'foo',
            title: 'Foo index',
          })),
          create: jest.fn(),
        } as unknown as Pick<DataViewsContract, 'get' | 'getIdsWithTitle' | 'create'>,
      });

      expect(cache.foo.getFieldByName('bytes')!.aggregationRestrictions).toEqual({
        sum: { agg: 'sum' },
      });
      expect(cache.foo.getFieldByName('timestamp')!.aggregationRestrictions).toEqual({
        date_histogram: { agg: 'date_histogram', fixed_interval: 'm' },
      });
    });

    it('should map meta flag', async () => {
      const cache = await loadIndexPatterns({
        cache: {},
        patterns: ['foo'],
        dataViews: {
          get: jest.fn(async () => ({
            id: 'foo',
            title: 'Foo index',
            metaFields: ['timestamp'],
            isPersisted: () => true,
            typeMeta: {
              aggs: {
                date_histogram: {
                  timestamp: {
                    agg: 'date_histogram',
                    fixed_interval: 'm',
                  },
                },
                sum: {
                  bytes: {
                    agg: 'sum',
                  },
                },
              },
            },
            fields: [
              {
                name: 'timestamp',
                displayName: 'timestampLabel',
                type: 'date',
                aggregatable: true,
                searchable: true,
              },
              {
                name: 'bytes',
                displayName: 'bytes',
                type: 'number',
                aggregatable: true,
                searchable: true,
              },
            ],
          })),
          getIdsWithTitle: jest.fn(async () => ({
            id: 'foo',
            title: 'Foo index',
          })),
          create: jest.fn(),
        } as unknown as Pick<DataViewsContract, 'get' | 'getIdsWithTitle' | 'create'>,
      });

      expect(cache.foo.getFieldByName('timestamp')!.meta).toEqual(true);
    });

    it('should call the refresh callback when loading new indexpatterns', async () => {
      const onIndexPatternRefresh = jest.fn();
      await loadIndexPatterns({
        cache: {
          '2': sampleIndexPatterns['2'],
        },
        patterns: ['1', '2'],
        dataViews: mockDataViewsService(),
        onIndexPatternRefresh,
      });

      expect(onIndexPatternRefresh).toHaveBeenCalled();
    });

    it('should not call the refresh callback when using the cache', async () => {
      const onIndexPatternRefresh = jest.fn();
      await loadIndexPatterns({
        cache: sampleIndexPatterns,
        patterns: ['1', '2'],
        dataViews: mockDataViewsService(),
        onIndexPatternRefresh,
      });

      expect(onIndexPatternRefresh).not.toHaveBeenCalled();
    });

    it('should load one of the not used indexpatterns if all used ones are not available', async () => {
      const dataViewsService = {
        get: jest.fn(async (id: string) => {
          if (id === '3') {
            return {
              id: '3',
              title: 'my-fake-index-pattern',
              timeFieldName: 'timestamp',
              hasRestrictions: false,
              fields: [],
              isPersisted: () => true,
            };
          }
          return Promise.reject();
        }),
        getIdsWithTitle: jest.fn(),
      } as unknown as Pick<DataViewsContract, 'get' | 'getIdsWithTitle' | 'create'>;
      const cache = await loadIndexPatterns({
        cache: {},
        patterns: ['1', '2'],
        notUsedPatterns: ['11', '3', '4', '5', '6', '7', '8', '9', '10'],
        dataViews: dataViewsService,
      });

      expect(cache).toEqual({
        3: expect.objectContaining({
          id: '3',
          title: 'my-fake-index-pattern',
          timeFieldName: 'timestamp',
          hasRestrictions: false,
          fields: [documentField],
        }),
      });
      // trying to load the used patterns 1 and 2, then trying the not used pattern 11 and succeeding with the pattern 3 - 4 loads
      expect(dataViewsService.get).toHaveBeenCalledTimes(4);
    });
  });

  describe('ensureIndexPattern', () => {
    it('should throw if the requested indexPattern cannot be loaded', async () => {
      const err = Error('NOPE!');
      const onError = jest.fn();
      const cache = await ensureIndexPattern({
        id: '3',
        dataViews: {
          get: jest.fn(async () => {
            throw err;
          }),
          getIdsWithTitle: jest.fn(),
        } as unknown as Pick<DataViewsContract, 'get' | 'getIdsWithTitle' | 'create'>,
        onError,
      });

      expect(cache).toBeUndefined();
      expect(onError).toHaveBeenCalledWith(Error('Missing indexpatterns'));
    });

    it('should ensure the requested indexpattern is loaded into the cache', async () => {
      const onError = jest.fn();
      const cache = await ensureIndexPattern({
        id: '2',
        dataViews: mockDataViewsService(),
        onError,
      });
      expect(cache).toEqual({ 2: expect.anything() });
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('syncExistingFields', () => {
    const dslQuery = {
      bool: {
        must: [],
        filter: [{ match_all: {} }],
        should: [],
        must_not: [],
      },
    };

    function getIndexPatternList() {
      return [
        { id: '1', title: '1', fields: [], hasRestrictions: false },
        { id: '2', title: '1', fields: [], hasRestrictions: false },
        { id: '3', title: '1', fields: [], hasRestrictions: false },
      ] as unknown as IndexPattern[];
    }

    it('should call once for each index pattern', async () => {
      const updateIndexPatterns = jest.fn();
      const fetchJson = jest.fn((path: string) => {
        const indexPatternTitle = last(path.split('/'));
        return {
          indexPatternTitle,
          existingFieldNames: ['field_1', 'field_2'].map(
            (fieldName) => `ip${indexPatternTitle}_${fieldName}`
          ),
        };
      }) as unknown as HttpHandler;

      await syncExistingFields({
        dateRange: { fromDate: '1900-01-01', toDate: '2000-01-01' },
        fetchJson,
        indexPatternList: getIndexPatternList(),
        updateIndexPatterns,
        dslQuery,
        onNoData: jest.fn(),
        currentIndexPatternTitle: 'abc',
        isFirstExistenceFetch: false,
        existingFields: {},
      });

      expect(fetchJson).toHaveBeenCalledTimes(3);
      expect(updateIndexPatterns).toHaveBeenCalledTimes(1);

      const [newState, options] = updateIndexPatterns.mock.calls[0];
      expect(options).toEqual({ applyImmediately: true });

      expect(newState).toEqual({
        isFirstExistenceFetch: false,
        existingFields: {
          '1': { ip1_field_1: true, ip1_field_2: true },
          '2': { ip2_field_1: true, ip2_field_2: true },
          '3': { ip3_field_1: true, ip3_field_2: true },
        },
      });
    });

    it('should call onNoData callback if current index pattern returns no fields', async () => {
      const updateIndexPatterns = jest.fn();
      const onNoData = jest.fn();
      const fetchJson = jest.fn((path: string) => {
        const indexPatternTitle = last(path.split('/'));
        return {
          indexPatternTitle,
          existingFieldNames:
            indexPatternTitle === '1'
              ? ['field_1', 'field_2'].map((fieldName) => `${indexPatternTitle}_${fieldName}`)
              : [],
        };
      }) as unknown as HttpHandler;

      const args = {
        dateRange: { fromDate: '1900-01-01', toDate: '2000-01-01' },
        fetchJson,
        indexPatternList: getIndexPatternList(),
        updateIndexPatterns,
        dslQuery,
        onNoData,
        currentIndexPatternTitle: 'abc',
        isFirstExistenceFetch: false,
        existingFields: {},
      };

      await syncExistingFields(args);

      expect(onNoData).not.toHaveBeenCalled();

      await syncExistingFields({ ...args, isFirstExistenceFetch: true });
      expect(onNoData).not.toHaveBeenCalled();
    });

    it('should set all fields to available and existence error flag if the request fails', async () => {
      const updateIndexPatterns = jest.fn();
      const fetchJson = jest.fn((path: string) => {
        return new Promise((resolve, reject) => {
          reject(new Error());
        });
      }) as unknown as HttpHandler;

      const args = {
        dateRange: { fromDate: '1900-01-01', toDate: '2000-01-01' },
        fetchJson,
        indexPatternList: [
          {
            id: '1',
            title: '1',
            hasRestrictions: false,
            fields: [{ name: 'field1' }, { name: 'field2' }] as IndexPatternField[],
          },
        ] as IndexPattern[],
        updateIndexPatterns,
        dslQuery,
        onNoData: jest.fn(),
        currentIndexPatternTitle: 'abc',
        isFirstExistenceFetch: false,
        existingFields: {},
      };

      await syncExistingFields(args);

      const [newState, options] = updateIndexPatterns.mock.calls[0];
      expect(options).toEqual({ applyImmediately: true });

      expect(newState.existenceFetchFailed).toEqual(true);
      expect(newState.existenceFetchTimeout).toEqual(false);
      expect(newState.existingFields['1']).toEqual({
        field1: true,
        field2: true,
      });
    });

    it('should set all fields to available and existence error flag if the request times out', async () => {
      const updateIndexPatterns = jest.fn();
      const fetchJson = jest.fn((path: string) => {
        return new Promise((resolve, reject) => {
          const error = createHttpFetchError(
            'timeout',
            'error',
            {} as Request,
            { status: 408 } as Response
          );
          reject(error);
        });
      }) as unknown as HttpHandler;

      const args = {
        dateRange: { fromDate: '1900-01-01', toDate: '2000-01-01' },
        fetchJson,
        indexPatternList: [
          {
            id: '1',
            title: '1',
            hasRestrictions: false,
            fields: [{ name: 'field1' }, { name: 'field2' }] as IndexPatternField[],
          },
        ] as IndexPattern[],
        updateIndexPatterns,
        dslQuery,
        onNoData: jest.fn(),
        currentIndexPatternTitle: 'abc',
        isFirstExistenceFetch: false,
        existingFields: {},
      };

      await syncExistingFields(args);

      const [newState, options] = updateIndexPatterns.mock.calls[0];
      expect(options).toEqual({ applyImmediately: true });

      expect(newState.existenceFetchFailed).toEqual(false);
      expect(newState.existenceFetchTimeout).toEqual(true);
      expect(newState.existingFields['1']).toEqual({
        field1: true,
        field2: true,
      });
    });
  });
});
