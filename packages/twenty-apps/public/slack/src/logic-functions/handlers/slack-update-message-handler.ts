import { isNonEmptyArray } from '@sniptt/guards';

import { type SlackMessageBody } from 'src/logic-functions/types/slack-message-body.type';
import { type SlackToolResult } from 'src/logic-functions/types/slack-tool-result.type';
import { type SlackUpdateMessageInput } from 'src/logic-functions/types/slack-update-message-input.type';
import { getSlackChatMessageBodyFields } from 'src/logic-functions/utils/get-slack-chat-message-body-fields';
import { getSlackClient } from 'src/logic-functions/utils/get-slack-client';
import { getSlackMessageBodyFallbacks } from 'src/logic-functions/utils/get-slack-message-body-fallbacks';
import { isSlackMarkdownFormatError } from 'src/logic-functions/utils/is-slack-markdown-format-error';
import { slackToolFailure } from 'src/logic-functions/utils/slack-tool-failure';

export const slackUpdateMessageHandler = async (
  parameters: SlackUpdateMessageInput,
): Promise<SlackToolResult> => {
  const slackClientResult = await getSlackClient();

  if (!slackClientResult.success) {
    return {
      success: false,
      message: 'Slack is not connected',
      error: slackClientResult.error,
    };
  }

  const { client } = slackClientResult;

  const updateWithBody = async (
    body: SlackMessageBody,
  ): Promise<SlackToolResult> => {
    const bodyFields = getSlackChatMessageBodyFields({
      messageText: parameters.newMessageText,
      ...body,
    });

    const data = await client.chat.update({
      channel: parameters.slackChannelId,
      ts: parameters.messageTimestamp,
      ...bodyFields,
    });

    return {
      success: true,
      message: 'Slack message updated.',
      slackTs: data.ts,
      channel: parameters.slackChannelId,
    };
  };

  const updateWithFirstRenderableBody = async ([
    body,
    ...remainingBodies
  ]: SlackMessageBody[]): Promise<SlackToolResult> => {
    try {
      return await updateWithBody(body);
    } catch (error) {
      if (
        !isNonEmptyArray(remainingBodies) ||
        !isSlackMarkdownFormatError(error)
      ) {
        return slackToolFailure('Failed to update Slack message', error);
      }

      return await updateWithFirstRenderableBody(remainingBodies);
    }
  };

  const messageBody: SlackMessageBody = {
    messageFormat: parameters.messageFormat,
    messageBlocks: parameters.messageBlocks,
  };

  return await updateWithFirstRenderableBody([
    messageBody,
    ...getSlackMessageBodyFallbacks(messageBody),
  ]);
};
