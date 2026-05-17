export type AiCallLogEntry = {
  id: string;
  createdAt: string;
  method: string;
  url: string;
  modelId: string;
  status: number;
  ok: boolean;
  requestJson: string;
  responseJson: string;
  error: string;
};
