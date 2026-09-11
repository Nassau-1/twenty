import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type LogicFunctionExecutorService } from 'src/engine/core-modules/logic-function/logic-function-executor/logic-function-executor.service';
import { ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { type ToolExecutionRef } from 'src/engine/core-modules/tool-provider/types/tool-execution-ref.type';

jest.mock(
  'src/engine/core-modules/logic-function/logic-function-executor/logic-function-executor.service',
  () => ({ LogicFunctionExecutorService: class {} }),
);

const LOGIC_FUNCTION_REF: Extract<
  ToolExecutionRef,
  { kind: 'logic_function' }
> = {
  kind: 'logic_function',
  logicFunctionId: 'logic-function-id',
};

const buildContext = (
  options: Pick<ToolProviderContext, 'userId' | 'userWorkspaceId'> = {},
): ToolProviderContext => ({
  workspaceId: 'workspace-id',
  roleId: 'role-id',
  rolePermissionConfig: { unionOf: ['role-id'] },
  ...options,
});

const buildService = (execute: jest.Mock) =>
  new ToolExecutorService(
    [],
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    { execute } as unknown as LogicFunctionExecutorService,
    undefined as never,
    undefined as never,
  );

describe('ToolExecutorService logic-function dispatch', () => {
  it.each([
    ['first principal', 'user-one', 'user-workspace-one'],
    ['second principal', 'user-two', 'user-workspace-two'],
  ])(
    'forwards the server-authenticated identity for %s',
    async (_label, userId, userWorkspaceId) => {
      const execute = jest.fn().mockResolvedValue({ data: { ok: true } });
      const service = buildService(execute);
      const args = {
        query: 'authorized input',
        userId: 'payload-user-id-must-not-control-identity',
        userWorkspaceId: 'payload-user-workspace-id-must-not-control-identity',
      };

      await service.dispatch(
        { executionRef: LOGIC_FUNCTION_REF } as never,
        args,
        buildContext({ userId, userWorkspaceId }),
      );

      expect(execute).toHaveBeenCalledWith({
        logicFunctionId: 'logic-function-id',
        workspaceId: 'workspace-id',
        payload: args,
        userId,
        userWorkspaceId,
      });
    },
  );

  it('does not manufacture an identity when the authenticated context has none', async () => {
    const execute = jest.fn().mockResolvedValue({ data: { ok: true } });
    const service = buildService(execute);

    await service.dispatch(
      { executionRef: LOGIC_FUNCTION_REF } as never,
      { userId: 'payload-user-id-must-not-control-identity' },
      buildContext(),
    );

    expect(execute).toHaveBeenCalledWith({
      logicFunctionId: 'logic-function-id',
      workspaceId: 'workspace-id',
      payload: { userId: 'payload-user-id-must-not-control-identity' },
      userId: undefined,
      userWorkspaceId: undefined,
    });
  });

  it('preserves the existing execution-error result', async () => {
    const execute = jest.fn().mockResolvedValue({
      data: null,
      error: { errorMessage: 'execution failed' },
    });
    const service = buildService(execute);

    await expect(
      service.dispatch(
        { executionRef: LOGIC_FUNCTION_REF } as never,
        {},
        buildContext({
          userId: 'user-one',
          userWorkspaceId: 'user-workspace-one',
        }),
      ),
    ).resolves.toEqual({
      success: false,
      message: 'Logic function execution failed',
      error: 'execution failed',
    });
  });
});
