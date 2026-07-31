import { type ObjectRecordEvent } from 'twenty-shared/database-events';

import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { FormulaReactiveService } from 'src/engine/metadata-modules/formula/formula-reactive.service';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

@Processor(MessageQueue.entityEventsToDbQueue)
export class FormulaRecomputeJob {
  constructor(
    private readonly formulaReactiveService: FormulaReactiveService,
  ) {}

  @Process(FormulaRecomputeJob.name)
  async handle(
    batch: WorkspaceEventBatch<ObjectRecordEvent<Record<string, unknown>>>,
  ): Promise<void> {
    await this.formulaReactiveService.recomputeFromEventBatch(batch);
  }
}
