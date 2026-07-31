import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { FormulaFieldHistoryEntity } from 'src/engine/metadata-modules/formula/entities/formula-field-history.entity';
import { FormulaVersionEntity } from 'src/engine/metadata-modules/formula/entities/formula-version.entity';
import { FormulaApplicationService } from 'src/engine/metadata-modules/formula/formula-application.service';
import { FormulaAuthorizationService } from 'src/engine/metadata-modules/formula/formula-authorization.service';
import { FormulaController } from 'src/engine/metadata-modules/formula/formula.controller';
import { FormulaDependencyPlannerService } from 'src/engine/metadata-modules/formula/formula-dependency-planner.service';
import { FormulaHistoryService } from 'src/engine/metadata-modules/formula/formula-history.service';
import { FormulaMetadataService } from 'src/engine/metadata-modules/formula/formula-metadata.service';
import { FormulaReactiveService } from 'src/engine/metadata-modules/formula/formula-reactive.service';
import { FormulaRecomputeJob } from 'src/engine/metadata-modules/formula/jobs/formula-recompute.job';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';

@Module({
  imports: [
    TokenModule,
    WorkspaceCacheModule,
    WorkspaceCacheStorageModule,
    PermissionsModule,
    TypeOrmModule.forFeature([
      FieldMetadataEntity,
      FormulaDefinitionEntity,
      FormulaFieldHistoryEntity,
      FormulaVersionEntity,
      ObjectMetadataEntity,
    ]),
  ],
  controllers: [FormulaController],
  providers: [
    FormulaApplicationService,
    FormulaAuthorizationService,
    FormulaDependencyPlannerService,
    FormulaHistoryService,
    FormulaMetadataService,
    FormulaReactiveService,
    FormulaRecomputeJob,
    provideWorkspaceScopedRepository(FormulaDefinitionEntity),
    provideWorkspaceScopedRepository(FormulaFieldHistoryEntity),
  ],
  exports: [
    FormulaDependencyPlannerService,
    FormulaHistoryService,
    FormulaMetadataService,
    FormulaReactiveService,
  ],
})
export class FormulaMetadataModule {}
