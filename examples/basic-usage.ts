/**
 * Example: Basic Usage of MedScribe Alliance TS SDK
 *
 * Demonstrates the full recording lifecycle with proper SDKResult error handling.
 * All public async methods return SDKResult<T> — expected errors are returned, not thrown.
 */

import {
  ScribeClient,
  ScribeError,
  AuthenticationError,
  ForbiddenError,
  SessionNotFoundError,
  SessionExpiredError,
  RateLimitError,
  ValidationError,
  SessionStatus,
} from '../src';
import type {
  SDKResult,
  CreateSessionResponse,
  GetSessionStatusResponse,
  StopRecordingResult,
  RecordingStateChangeEvent,
  AudioEvent,
  UploadEvent,
  SessionEvent,
  ErrorEvent,
  TokenRequiredEvent,
} from '../src';

// ─── 1. Initialize Client ──────────────────────────────────────────────────────

const client = new ScribeClient({
  baseUrl: 'https://api.eka.care/voice/api/v2',
  accessToken: 'YOUR_ACCESS_TOKEN',
  debug: true,
});

// ─── 2. Register Callbacks ─────────────────────────────────────────────────────
// Register before starting recording so you don't miss events.

client.registerCallback('onRecordingStateChange', (event: RecordingStateChangeEvent) => {
  console.log(`[Recording] ${event.type} at ${event.timestamp}`);
});

client.registerCallback('onAudioEvent', (event: AudioEvent) => {
  switch (event.type) {
    case 'user_speech':
      console.log(`[Audio] User ${event.data.isSpeaking ? 'started' : 'stopped'} speaking`);
      break;
    case 'silence_warning':
      console.log(`[Audio] Silence detected for ${event.data.durationMs}ms`);
      break;
    case 'chunk_ready':
      console.log(`[Audio] Chunk ready: ${event.data.fileName}`);
      break;
    case 'frame_processed':
      // High-frequency — usually only log in debug mode
      break;
  }
});

client.registerCallback('onUploadEvent', (event: UploadEvent) => {
  switch (event.type) {
    case 'progress':
      console.log(`[Upload] ${event.data.successCount}/${event.data.totalCount} uploaded`);
      break;
    case 'failed':
      console.error(`[Upload] Failed: ${event.data.fileName} — ${event.data.error}`);
      break;
  }
});

client.registerCallback('onSessionEvent', (event: SessionEvent) => {
  switch (event.type) {
    case 'created':
      console.log(`[Session] Created: ${event.data.session_id}`);
      break;
    case 'ended':
      console.log(`[Session] Ended: ${event.data.session_id}, files received: ${event.data.audio_files_received}`);
      break;
  }
});

client.registerCallback('onError', (event: ErrorEvent) => {
  console.error(`[SDK Error] ${event.type}: ${event.error.code} — ${event.error.message}`);
});

client.registerCallback('onTokenRequired', (event: TokenRequiredEvent) => {
  console.log('[Auth] Token required — refreshing...');
  // In a real app, call your auth refresh endpoint here
  const newToken = 'REFRESHED_TOKEN';
  event.resolve(newToken);
});

// ─── 3. Full Recording Flow ────────────────────────────────────────────────────

async function runFullFlow() {
  // Step 1: Initialize (fetches discovery document)
  const initResult = await client.init();
  if (!initResult.success) {
    console.error('Init failed:', initResult.error.message);
    return;
  }
  console.log('SDK initialized');

  // Step 2: Start recording
  const startResult: SDKResult<CreateSessionResponse> = await client.startRecording({
    templates: ['soap', 'medications'],
    languageHint: ['en'],
    model: 'pro',
    additionalData: {
      patient_id: 'pat_12345',
      encounter_id: 'enc_67890',
    },
  });

  if (!startResult.success) {
    // Handle specific error types via httpStatus
    handleError(startResult.error);
    return;
  }

  const session = startResult.data;
  console.log('Session created:', session.session_id);
  console.log('Upload URL:', session.upload_url);

  // Step 3: Recording is now active — audio is being captured, chunked, and uploaded.
  // You can pause/resume:
  //   client.pauseRecording();
  //   client.resumeRecording();
  //
  // Wait for some recording time...
  console.log('Recording... (stop after desired duration)');

  // Step 4: End recording — stops mic, flushes last chunk, waits for uploads, ends session
  const endResult: SDKResult<StopRecordingResult> = await client.endRecording();

  if (!endResult.success) {
    handleError(endResult.error);
    return;
  }

  const stopResult = endResult.data;
  console.log(`Recording stopped. Total files: ${stopResult.totalFiles}`);
  if (stopResult.failedUploads.length > 0) {
    console.warn('Failed uploads:', stopResult.failedUploads);
  }

  // Step 5: Poll for completion
  const pollResult: SDKResult<GetSessionStatusResponse> = await client.pollForCompletion(
    session.session_id,
    {
      maxAttempts: 60,
      intervalMs: 2000,
      onProgress: (status) => {
        console.log(`  Polling... status: ${status.status}`);
      },
    }
  );

  if (!pollResult.success) {
    handleError(pollResult.error);
    return;
  }

  const result = pollResult.data;
  console.log('\n=== RESULTS ===');
  console.log('Status:', result.status);
  console.log('Model used:', result.model_used);
  console.log('Language:', result.language_detected);

  if (result.transcript) {
    console.log('\nTranscript:', result.transcript);
  }

  if (result.templates) {
    for (const [templateId, entry] of Object.entries(result.templates)) {
      if (entry.status === 'success') {
        console.log(`\n${templateId}: SUCCESS`);
        console.log(JSON.stringify(entry.data, null, 2));
      } else {
        console.log(`\n${templateId}: FAILED — ${entry.error?.message}`);
      }
    }
  }

  // Handle partial results
  if (result.status === SessionStatus.PARTIAL && result.processing_errors) {
    console.warn('\nProcessing errors:');
    result.processing_errors.forEach((err) => {
      console.warn(`  ${err.type}: ${err.message}`);
    });
  }
}

// ─── 4. Error Handling ─────────────────────────────────────────────────────────

function handleError(error: ScribeError) {
  // All errors have: error.message, error.code, error.httpStatus, error.details

  if (error instanceof AuthenticationError) {
    console.error('Authentication failed:', error.message);
    // Redirect to login or refresh token
  } else if (error instanceof ForbiddenError) {
    console.error('Forbidden:', error.message);
    // Insufficient permissions
  } else if (error instanceof RateLimitError) {
    console.error('Rate limited. Retry after:', error.details?.retry_after_seconds, 'seconds');
  } else if (error instanceof ValidationError) {
    console.error('Validation error:', error.message);
  } else if (error instanceof SessionNotFoundError) {
    console.error('Session not found:', error.message);
  } else if (error instanceof SessionExpiredError) {
    console.error('Session expired:', error.message);
  } else {
    // Generic ScribeError — use httpStatus to distinguish server errors
    console.error(`Error [${error.code}] HTTP ${error.httpStatus}:`, error.message);
    if (error.details) {
      console.error('Details:', error.details);
    }
  }
}

// ─── 5. Session-Only Flow (no recording) ────────────────────────────────────────

async function sessionOnlyFlow() {
  const initResult = await client.init();
  if (!initResult.success) return;

  // Create session directly (e.g., audio uploaded externally)
  const createResult = await client.createSession({
    templates: ['soap'],
    upload_type: 'chunked',
    communication_protocol: 'http',
  });
  if (!createResult.success) {
    handleError(createResult.error);
    return;
  }

  console.log('Session:', createResult.data.session_id);

  // Check status
  const statusResult = await client.getSessionStatus(createResult.data.session_id);
  if (!statusResult.success) {
    handleError(statusResult.error);
    return;
  }

  console.log('Status:', statusResult.data.status);

  // Handle 410 expired sessions (returned as data, not error)
  if (statusResult.data.status === SessionStatus.EXPIRED) {
    console.log('Session expired at:', statusResult.data.expires_at);
  }
}

// Run
runFullFlow();
