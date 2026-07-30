import { type KnownBlock } from '@slack/web-api';
import { isNonEmptyArray } from '@sniptt/guards';

import { type SlackMessageBody } from 'src/logic-functions/types/slack-message-body.type';

type SlackChatMessageBodyFields =
  | {
      blocks: KnownBlock[];
      text: string;
      markdown_text?: never;
      mrkdwn?: never;
    }
  | {
      markdown_text: string;
      blocks?: never;
      text?: never;
      mrkdwn?: never;
    }
  | {
      text: string;
      blocks?: never;
      markdown_text?: never;
      mrkdwn?: boolean;
    };

export const getSlackChatMessageBodyFields = ({
  messageText,
  messageFormat,
  messageBlocks,
}: { messageText: string } & SlackMessageBody): SlackChatMessageBodyFields => {
  if (isNonEmptyArray(messageBlocks)) {
    return { blocks: messageBlocks, text: messageText };
  }

  switch (messageFormat) {
    case 'markdown':
      return { markdown_text: messageText };
    case 'plain':
      return { text: messageText, mrkdwn: false };
    default:
      return { text: messageText };
  }
};
