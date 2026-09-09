import { CommonCreateOneQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-one-query-runner.service';
import { type CommonCreateManyQueryRunnerService } from 'src/engine/api/common/common-query-runners/common-create-many-query-runner/common-create-many-query-runner.service';
import { CommonQueryRunnerExceptionCode } from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { type CommonExtendedQueryRunnerContext } from 'src/engine/api/common/types/common-extended-query-runner-context.type';

jest.mock(
  'src/engine/api/common/common-query-runners/common-base-query-runner.service',
  () => ({ CommonBaseQueryRunnerService: class {} }),
);
jest.mock(
  'src/engine/api/common/common-query-runners/common-create-many-query-runner/common-create-many-query-runner.service',
  () => ({ CommonCreateManyQueryRunnerService: class {} }),
);

describe('CommonCreateOneQueryRunnerService guarded upsert result', () => {
  const context = {} as CommonExtendedQueryRunnerContext;
  const args = {
    data: { id: '00000000-0000-4000-8000-000000000001' },
    upsert: true,
  } as Parameters<CommonCreateOneQueryRunnerService['run']>[0];

  it('returns a supported not-found error when the writer returns no row', async () => {
    const run = jest.fn().mockResolvedValue([]);
    const service = new CommonCreateOneQueryRunnerService({
      run,
    } as unknown as CommonCreateManyQueryRunnerService);

    await expect(service.run(args, context)).rejects.toMatchObject({
      code: CommonQueryRunnerExceptionCode.RECORD_NOT_FOUND,
    });
    expect(run).toHaveBeenCalledWith({ ...args, data: [args.data] }, context);
  });

  it('preserves a successful upsert result', async () => {
    const record = { id: args.data.id, name: 'Call' };
    const run = jest.fn().mockResolvedValue([record]);
    const service = new CommonCreateOneQueryRunnerService({
      run,
    } as unknown as CommonCreateManyQueryRunnerService);

    await expect(service.run(args, context)).resolves.toBe(record);
  });

  it('does not swallow a writer authorization failure', async () => {
    const error = new Error('Permission denied');
    const run = jest.fn().mockRejectedValue(error);
    const service = new CommonCreateOneQueryRunnerService({
      run,
    } as unknown as CommonCreateManyQueryRunnerService);

    await expect(service.run(args, context)).rejects.toBe(error);
  });
});
