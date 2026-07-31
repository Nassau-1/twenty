import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.26.0', 1785434417760)
export class AddFormulaMetadataFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "core"."formulaDefinition" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "objectMetadataId" uuid NOT NULL,
        "outputFieldMetadataId" uuid NOT NULL,
        "activeVersionId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_FORMULA_DEFINITION" PRIMARY KEY ("id"),
        CONSTRAINT "FK_FORMULA_DEFINITION_WORKSPACE"
          FOREIGN KEY ("workspaceId") REFERENCES "core"."workspace"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_FORMULA_DEFINITION_OBJECT"
          FOREIGN KEY ("objectMetadataId") REFERENCES "core"."objectMetadata"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_FORMULA_DEFINITION_OUTPUT_FIELD"
          FOREIGN KEY ("outputFieldMetadataId") REFERENCES "core"."fieldMetadata"("id") ON DELETE CASCADE,
        CONSTRAINT "IDX_FORMULA_DEFINITION_OUTPUT_FIELD_ID_UNIQUE"
          UNIQUE ("outputFieldMetadataId"),
        CONSTRAINT "IDX_FORMULA_DEFINITION_OUTPUT_FIELD_UNIQUE"
          UNIQUE ("workspaceId", "objectMetadataId", "outputFieldMetadataId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_FORMULA_DEFINITION_WORKSPACE_OBJECT"
      ON "core"."formulaDefinition" ("workspaceId", "objectMetadataId")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "core"."formulaVersion" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "definitionId" uuid NOT NULL,
        "editorDocument" jsonb NOT NULL,
        "ast" jsonb NOT NULL,
        "dependencies" jsonb NOT NULL,
        "outputType" character varying NOT NULL,
        "isNullable" boolean NOT NULL,
        "compilerVersion" character varying NOT NULL,
        "createdByWorkspaceMemberId" uuid,
        "reason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_FORMULA_VERSION" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_FORMULA_VERSION_OUTPUT_TYPE"
          CHECK ("outputType" IN ('BOOLEAN', 'NUMBER', 'TEXT')),
        CONSTRAINT "FK_FORMULA_VERSION_DEFINITION"
          FOREIGN KEY ("definitionId") REFERENCES "core"."formulaDefinition"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_FORMULA_VERSION_DEFINITION_CREATED_AT"
      ON "core"."formulaVersion" ("definitionId", "createdAt")
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_FORMULA_DEFINITION_ACTIVE_VERSION'
            AND conrelid = '"core"."formulaDefinition"'::regclass
        ) THEN
          ALTER TABLE "core"."formulaDefinition"
          ADD CONSTRAINT "FK_FORMULA_DEFINITION_ACTIVE_VERSION"
          FOREIGN KEY ("activeVersionId") REFERENCES "core"."formulaVersion"("id") ON DELETE SET NULL;
        END IF;
      END
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "core"."formulaDefinition" DROP CONSTRAINT IF EXISTS "FK_FORMULA_DEFINITION_ACTIVE_VERSION"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "core"."formulaVersion"');
    await queryRunner.query('DROP TABLE IF EXISTS "core"."formulaDefinition"');
  }
}
