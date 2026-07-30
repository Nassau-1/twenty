import { type QueryRunner } from 'typeorm';

import { AddFormulaMetadataFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-26/2-26-instance-command-fast-1785434417760-add-formula-metadata';

describe('AddFormulaMetadataFastInstanceCommand', () => {
  const query = jest.fn();
  const queryRunner = { query } as unknown as QueryRunner;
  const command = new AddFormulaMetadataFastInstanceCommand();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates definition and immutable version storage before the active-version foreign key', async () => {
    await command.up(queryRunner);

    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[0][0]).toContain(
      'CREATE TABLE "core"."formulaDefinition"',
    );
    expect(query.mock.calls[2][0]).toContain(
      'CREATE TABLE "core"."formulaVersion"',
    );
    expect(query.mock.calls[4][0]).toContain(
      'ADD CONSTRAINT "FK_FORMULA_DEFINITION_ACTIVE_VERSION"',
    );
  });

  it('drops the active-version foreign key before both tables', async () => {
    await command.down(queryRunner);

    expect(query.mock.calls.map(([statement]) => statement)).toEqual([
      expect.stringContaining(
        'DROP CONSTRAINT IF EXISTS "FK_FORMULA_DEFINITION_ACTIVE_VERSION"',
      ),
      'DROP TABLE IF EXISTS "core"."formulaVersion"',
      'DROP TABLE IF EXISTS "core"."formulaDefinition"',
    ]);
  });
});
