import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { FormulaVersionEntity } from 'src/engine/metadata-modules/formula/entities/formula-version.entity';
import { FormulaMetadataService } from 'src/engine/metadata-modules/formula/formula-metadata.service';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FieldMetadataEntity,
      FormulaDefinitionEntity,
      FormulaVersionEntity,
    ]),
  ],
  providers: [
    FormulaMetadataService,
    provideWorkspaceScopedRepository(FormulaDefinitionEntity),
  ],
  exports: [FormulaMetadataService],
})
export class FormulaMetadataModule {}
