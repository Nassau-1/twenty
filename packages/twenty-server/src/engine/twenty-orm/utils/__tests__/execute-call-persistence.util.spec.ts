import { FieldMetadataType } from 'twenty-shared/types';
import { type QueryRunner } from 'typeorm';

import { getFlatFieldMetadataMock } from 'src/engine/metadata-modules/flat-field-metadata/__mocks__/get-flat-field-metadata.mock';
import { getFlatObjectMetadataMock } from 'src/engine/metadata-modules/flat-object-metadata/__mocks__/get-flat-object-metadata.mock';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { executeCallPersistence } from 'src/engine/twenty-orm/utils/execute-call-persistence.util';

const object = getFlatObjectMetadataMock({
  id: 'call-object',
  nameSingular: 'call',
});
const context = {
  flatFieldMetadataMaps: {
    byUniversalIdentifier: {
      binding: getFlatFieldMetadataMock({
        objectMetadataId: object.id,
        name: 'vexaMeetingId',
        type: FieldMetadataType.TEXT,
      }),
    },
  },
} as Pick<WorkspaceInternalContext, 'flatFieldMetadataMaps'>;
const id = '00000000-0000-4000-8000-000000000001';

function fixture(reserved = false, active = false) {
  const runner = {
    isTransactionActive: active,
    connection: {
      getMetadata: () => ({ schema: 'workspace_test', tableName: '_call' }),
      driver: { escape: (name: string) => `"${name.replaceAll('"', '""')}"` },
    },
    startTransaction: jest.fn(async () => {
      runner.isTransactionActive = true;
    }),
    commitTransaction: jest.fn(async () => {
      runner.isTransactionActive = false;
    }),
    rollbackTransaction: jest.fn(async () => {
      runner.isTransactionActive = false;
    }),
    query: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(reserved ? [{ exists: 1 }] : []),
  };
  return runner;
}

describe('Call entity persistence fence', () => {
  it.each(['save', 'remove', 'soft-remove', 'recover'])(
    'rejects %s on a previously loaded Call now reserved',
    async () => {
      const runner = fixture(true);
      const execute = jest.fn();
      await expect(
        executeCallPersistence(
          runner as unknown as QueryRunner,
          'call',
          object,
          context,
          { id },
          execute,
        ),
      ).rejects.toThrow('Call is reserved');
      expect(execute).not.toHaveBeenCalled();
      expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(runner.commitTransaction).not.toHaveBeenCalled();
    },
  );

  it('holds the table barrier through persistence and commits only its own transaction', async () => {
    const runner = fixture();
    const execute = jest.fn(async () => {
      expect(runner.isTransactionActive).toBe(true);
      expect(runner.query.mock.calls[0][0]).toBe(
        'LOCK TABLE "workspace_test"."_call" IN SHARE ROW EXCLUSIVE MODE',
      );
      expect(runner.query.mock.calls[1][1]).toEqual([[id], 'zo-pending:%']);
      return 'saved';
    });
    await expect(
      executeCallPersistence(
        runner as unknown as QueryRunner,
        'call',
        object,
        context,
        { id },
        execute,
      ),
    ).resolves.toBe('saved');
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('also fences creation with absent IDs against concurrent inserts', async () => {
    const runner = fixture();
    await executeCallPersistence(
      runner as unknown as QueryRunner,
      'call',
      object,
      context,
      { name: 'new' },
      async () => undefined,
    );
    expect(runner.query).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('keeps an existing transaction owned by the caller', async () => {
    const runner = fixture(false, true);
    await executeCallPersistence(
      runner as unknown as QueryRunner,
      'call',
      object,
      context,
      { id },
      async () => undefined,
    );
    expect(runner.startTransaction).not.toHaveBeenCalled();
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.isTransactionActive).toBe(true);
  });

  it('rolls back the owned transaction when persistence fails', async () => {
    const runner = fixture();
    await expect(
      executeCallPersistence(
        runner as unknown as QueryRunner,
        'call',
        object,
        context,
        { id },
        async () => {
          throw new Error('write failed');
        },
      ),
    ).rejects.toThrow('write failed');
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not change non-Call persistence', async () => {
    const runner = fixture();
    await executeCallPersistence(
      runner as unknown as QueryRunner,
      'company',
      { ...object, nameSingular: 'company' },
      context,
      { id },
      async () => undefined,
    );
    expect(runner.query).not.toHaveBeenCalled();
    expect(runner.startTransaction).not.toHaveBeenCalled();
  });
});
