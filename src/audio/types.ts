import { ErrorCode } from '../constants';

export type TAudioChunksInfo = {
  fileName: string;
  timestamp: { st: string; et: string };
  response?: string;
} & (
  | {
      status: 'pending';
      audioFrames: Float32Array;
      fileBlob?: undefined;
    }
  | {
      status: 'success';
      audioFrames?: undefined;
      fileBlob?: undefined;
    }
  | {
      status: 'failure';
      fileBlob: Blob;
      audioFrames?: undefined;
    }
);

export type TVadFramesCallback = (args: {
  error_code?: ErrorCode;
  status_code: number;
  message?: string;
  request?: string;
}) => void;

export type TVadFrameProcessedCallback = (args: {
  probabilities: {
    notSpeech: number;
    isSpeech: number;
  };
  frame: Float32Array;
}) => void;


export type UploadProgressCallback = (success: string[], total: number) => void;

export type TUserSpeechCallback = (isSpeech: boolean) => void;
