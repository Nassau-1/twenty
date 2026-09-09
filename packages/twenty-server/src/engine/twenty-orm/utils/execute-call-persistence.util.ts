import {
  type EntityTarget,
  type ObjectLiteral,
  type QueryRunner,
} from 'typeorm';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import {
  TwentyORMException,
  TwentyORMExceptionCode,
} from 'src/engine/twenty-orm/exceptions/twenty-orm.exception';
import {
  isReservedCallObject,
  validateCallReservationValues,
} from 'src/engine/twenty-orm/utils/call-reservation-fence.util';

// EntityPersistExecutor bypasses workspace builders. Serialize its short Call
// transaction against SQL writers, including inserts of previously absent IDs.
// The durable reservation never holds this database lock across bot dispatch.
export async function executeCallPersistence<T>(
  runner: QueryRunner,
  target: EntityTarget<ObjectLiteral>,
  object: FlatObjectMetadata,
  context: Pick<WorkspaceInternalContext, 'flatFieldMetadataMaps'>,
  entities: ObjectLiteral | ObjectLiteral[],
  execute: () => Promise<T>,
): Promise<T> {
  if (!isReservedCallObject(object, context)) return execute();
  validateCallReservationValues(object, context, entities);
  const rows = Array.isArray(entities) ? entities : [entities];
  const ids = rows.map((row) => row.id).filter((id) => id !== undefined);
  const metadata = runner.connection.getMetadata(target);
  const escape = (name: string) => runner.connection.driver.escape(name);
  const table = [metadata.schema, metadata.tableName]
    .filter(Boolean)
    .map(escape)
    .join('.');
  const ownedTransaction = !runner.isTransactionActive;
  if (ownedTransaction) await runner.startTransaction();
  try {
    await runner.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
    const reserved = ids.length
      ? await runner.query(
          `SELECT 1 FROM ${table} WHERE "id" = ANY($1::uuid[]) AND "vexaMeetingId" LIKE $2 LIMIT 1`,
          [ids, 'zo-pending:%'],
        )
      : [];
    if (reserved.length) {
      throw new TwentyORMException(
        'Call is reserved for bot dispatch',
        TwentyORMExceptionCode.INVALID_INPUT,
      );
    }
    const result = await execute();
    if (ownedTransaction) await runner.commitTransaction();
    return result;
  } catch (error) {
    if (ownedTransaction && runner.isTransactionActive)
      await runner.rollbackTransaction();
    throw error;
  }
}
