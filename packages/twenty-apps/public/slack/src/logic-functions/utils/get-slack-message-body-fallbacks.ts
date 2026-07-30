import { isNonEmptyArray } from '@sniptt/guards';

import { type SlackMessageBody } from 'src/logic-functions/types/slack-message-body.type';

// a body Slack rejects degrades one step at a time: blocks keep the layout, markdown_text keeps the links, plain text keeps the answer
export const getSlackMessageBodyFallbacks = ({
  messageFormat,
  messageBlocks,
}: SlackMessageBody): SlackMessageBody[] => {
  if (isNonEmptyArray(messageBlocks)) {
    return [{ messageFormat: 'markdown' }, { messageFormat: 'plain' }];
  }

  if (messageFormat === 'markdown') {
    return [{ messageFormat: 'plain' }];
  }

  return [];
};
