import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { REACT_APP_SERVER_BASE_URL } from '~/config';
import { type FormulaEditorDocument } from 'twenty-shared/formula';

export type FormulaMetadataApiInput = {
  objectMetadataId: string;
  outputFieldMetadataId: string;
  document: FormulaEditorDocument;
  reason?: string;
};

const getErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as {
      message?: string | string[];
    };

    if (Array.isArray(body.message)) {
      return body.message.join(' ');
    }
    if (typeof body.message === 'string') {
      return body.message;
    }
  } catch {
    // The status fallback below is intentionally free of response payload data.
  }

  return `Formula request failed with status ${response.status}.`;
};

const postFormulaMetadata = async ({
  path,
  input,
}: {
  path: string;
  input: FormulaMetadataApiInput;
}): Promise<unknown> => {
  const accessToken =
    getTokenPair()?.accessOrWorkspaceAgnosticToken?.token ?? null;

  if (accessToken === null) {
    throw new Error('Your session is no longer authenticated.');
  }

  const response = await fetch(
    `${REACT_APP_SERVER_BASE_URL}/rest/metadata/formulas${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response.json();
};

export const planFormulaMetadata = (input: FormulaMetadataApiInput) =>
  postFormulaMetadata({ path: '/plan', input });

export const createFormulaMetadata = (input: FormulaMetadataApiInput) =>
  postFormulaMetadata({ path: '', input });
