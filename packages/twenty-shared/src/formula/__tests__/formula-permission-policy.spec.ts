import {
  canQueryFormulaResult,
  decideFormulaResultAccess,
} from '../formula-permission-policy';

describe('Formula permission policy', () => {
  it('exposes a ready result only when the result and every dependency are readable', () => {
    const access = decideFormulaResultAccess({
      canReadResultField: true,
      canReadResultObject: true,
      dependencies: [
        { canReadFieldValue: true, canReadObjectRecords: true },
        { canReadFieldValue: true, canReadObjectRecords: true },
      ],
    });

    expect(access).toEqual({ state: 'VISIBLE' });
    expect(
      canQueryFormulaResult({ access, materializationState: 'READY' }),
    ).toBe(true);
  });

  it('returns a distinct redacted state for an unreadable dependency', () => {
    const access = decideFormulaResultAccess({
      canReadResultField: true,
      canReadResultObject: true,
      dependencies: [{ canReadFieldValue: false, canReadObjectRecords: true }],
    });

    expect(access).toEqual({
      state: 'REDACTED',
      reason: 'DEPENDENCY_NOT_READABLE',
    });
    expect(
      canQueryFormulaResult({ access, materializationState: 'READY' }),
    ).toBe(false);
  });

  it.each(['DISABLED', 'ERROR', 'PENDING'] as const)(
    'does not expose a visible result while materialization is %s',
    (materializationState) => {
      expect(
        canQueryFormulaResult({
          access: { state: 'VISIBLE' },
          materializationState,
        }),
      ).toBe(false);
    },
  );

  it('fails closed for unsupported dependency paths', () => {
    expect(
      decideFormulaResultAccess({
        canReadResultField: true,
        canReadResultObject: true,
        dependencies: [],
        hasUnsupportedDependency: true,
      }),
    ).toEqual({
      state: 'REDACTED',
      reason: 'UNSUPPORTED_DEPENDENCY',
    });
  });
});
