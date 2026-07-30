import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { PermissionFlagType } from 'twenty-shared/constants';

import { RestApiExceptionFilter } from 'src/engine/api/rest/rest-api-exception.filter';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { CreateFormulaInput } from 'src/engine/metadata-modules/formula/dtos/create-formula.input';
import { FormulaApplicationService } from 'src/engine/metadata-modules/formula/formula-application.service';
import { PermissionsRestApiExceptionFilter } from 'src/engine/metadata-modules/permissions/utils/permissions-rest-api-exception.filter';

@Controller('rest/metadata/formulas')
@UseGuards(
  JwtAuthGuard,
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.DATA_MODEL),
)
@UseFilters(PermissionsRestApiExceptionFilter, RestApiExceptionFilter)
@UsePipes(new ValidationPipe({ transform: true }))
export class FormulaController {
  constructor(
    private readonly formulaApplicationService: FormulaApplicationService,
  ) {}

  @Post()
  createFormula(
    @Body() input: CreateFormulaInput,
    @AuthWorkspace() { id: workspaceId }: WorkspaceEntity,
  ) {
    return this.formulaApplicationService.createFormula({
      workspaceId,
      objectMetadataId: input.objectMetadataId,
      outputFieldMetadataId: input.outputFieldMetadataId,
      document: input.document,
      reason: input.reason ?? null,
    });
  }

  @Get(':id')
  getFormula(
    @Param('id', new ParseUUIDPipe()) formulaDefinitionId: string,
    @AuthWorkspace() { id: workspaceId }: WorkspaceEntity,
  ) {
    return this.formulaApplicationService.getFormula({
      workspaceId,
      formulaDefinitionId,
    });
  }

  @Post(':id/records/:recordId/recompute')
  recomputeRecord(
    @Param('id', new ParseUUIDPipe()) formulaDefinitionId: string,
    @Param('recordId', new ParseUUIDPipe()) recordId: string,
    @AuthWorkspace() { id: workspaceId }: WorkspaceEntity,
  ) {
    return this.formulaApplicationService.recomputeRecord({
      workspaceId,
      formulaDefinitionId,
      recordId,
    });
  }
}
