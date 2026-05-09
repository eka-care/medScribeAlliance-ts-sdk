import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ScribeClient,
  ScribeError,
  AuthenticationError,
  ForbiddenError,
  RateLimitError,
  SessionStatus,
} from '../../../src';
import type {
  CreateSessionResponse,
  GetSessionStatusResponse,
  StopRecordingResult,
  RecordingStateChangeEvent,
  AudioEvent,
  UploadEvent,
  SessionEvent,
  ErrorEvent,
  TokenRequiredEvent,
  SDKResult,
} from '../../../src';
import './App.css';

type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

interface LogEntry {
  timestamp: Date;
  type: 'info' | 'error' | 'event' | 'success';
  message: string;
}

function App() {
  // State
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<CreateSessionResponse | null>(null);
  const [stopResult, setStopResult] = useState<StopRecordingResult | null>(null);
  const [outputStatus, setOutputStatus] = useState<GetSessionStatusResponse | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [, setHasMicPermission] = useState<boolean | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Configuration
  const [config, setConfig] = useState({
    baseUrl: '',
    accessToken: '',
    templates: '040565ca-fe5d-4d4c-94a8-e479a213eb0f',
    model: '',
    debug: true,
  });

  // Refs
  const clientRef = useRef<ScribeClient | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Add log entry
  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs((prev) => [...prev, { timestamp: new Date(), type, message }]);
  }, []);

  // Format error for logging
  const formatError = useCallback((error: ScribeError): string => {
    let msg = `[${error.code ?? 'unknown'}]`;
    if (error.httpStatus) msg += ` HTTP ${error.httpStatus}`;
    msg += ` ${error.message}`;
    if (error instanceof AuthenticationError) msg = `Auth Failed: ${msg}`;
    else if (error instanceof ForbiddenError) msg = `Forbidden: ${msg}`;
    else if (error instanceof RateLimitError) msg = `Rate Limited: ${msg}`;
    return msg;
  }, []);

  // Timer functions
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsedTime(0);
    timerRef.current = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
  }, []);

  const pauseTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resumeTimer = useCallback(() => {
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetTimer = useCallback(() => {
    stopTimer();
    setElapsedTime(0);
  }, [stopTimer]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ─── Register SDK Callbacks ────────────────────────────────────────────────

  const registerCallbacks = useCallback(
    (client: ScribeClient) => {
      client.registerCallback('onRecordingStateChange', (event: RecordingStateChangeEvent) => {
        addLog('event', `Recording state: ${event.type}`);
      });

      client.registerCallback('onAudioEvent', (event: AudioEvent) => {
        switch (event.type) {
          case 'user_speech':
            addLog('event', `User ${event.data.isSpeaking ? 'started' : 'stopped'} speaking`);
            break;
          case 'silence_warning':
            addLog('event', `Silence detected for ${event.data.durationMs}ms`);
            break;
          case 'chunk_ready':
            addLog('event', `Chunk ready: ${event.data.fileName}`);
            break;
          case 'frame_processed':
            // High frequency — skip logging
            break;
        }
      });

      client.registerCallback('onUploadEvent', (event: UploadEvent) => {
        switch (event.type) {
          case 'progress':
            addLog('info', `Upload: ${event.data.successCount}/${event.data.totalCount}`);
            break;
          case 'failed':
            addLog('error', `Upload failed: ${event.data.fileName} — ${event.data.error}`);
            break;
        }
      });

      client.registerCallback('onSessionEvent', (event: SessionEvent) => {
        switch (event.type) {
          case 'created':
            addLog('event', `Session created: ${event.data.session_id}`);
            break;
          case 'ended':
            addLog(
              'event',
              `Session ended: ${event.data.session_id}, files: ${event.data.audio_files_received}`
            );
            break;
        }
      });

      client.registerCallback('onError', (event: ErrorEvent) => {
        addLog('error', `SDK Error [${event.error.code}]: ${event.error.message}`);
      });

      client.registerCallback('onTokenRequired', (event: TokenRequiredEvent) => {
        addLog('event', 'Token refresh required — prompting...');
        // In a real app, call your auth refresh endpoint.
        // For demo, we re-use the current access token.
        const token = config.accessToken;
        if (token) {
          event.resolve(token);
          addLog('success', 'Token refreshed');
        } else {
          addLog('error', 'No token available to refresh');
        }
      });
    },
    [addLog, config.accessToken]
  );

  // ─── Initialize SDK ────────────────────────────────────────────────────────

  const initializeSDK = useCallback(async () => {
    if (!config.baseUrl) {
      addLog('error', 'Base URL is required');
      return;
    }

    setIsLoading(true);
    addLog('info', 'Initializing SDK...');

    try {
      // Reset any existing client
      if (clientRef.current) {
        await clientRef.current.reset();
        clientRef.current = null;
      }

      const client = new ScribeClient({
        baseUrl: config.baseUrl,
        accessToken: config.accessToken || undefined,
        debug: config.debug,
        workerScriptUrl: '/worker.bundle.js',
      });

      // Register callbacks before init
      registerCallbacks(client);

      const initResult: SDKResult<void> = await client.init();

      if (!initResult.success) {
        addLog('error', `Init failed: ${formatError(initResult.error)}`);
        setIsLoading(false);
        return;
      }

      clientRef.current = client;
      setIsInitialized(true);
      addLog('success', 'SDK initialized successfully');

      // Show discovery info
      const discovery = client.getDiscoveryDocument();
      if (discovery) {
        addLog('info', `Service: ${discovery.service?.name ?? discovery.protocol}`);
      }
    } catch (error) {
      // Only programmer errors throw (bad config)
      addLog('error', `Init threw: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [config, addLog, formatError, registerCallbacks]);

  // ─── Microphone Permission ─────────────────────────────────────────────────

  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    try {
      addLog('info', 'Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setHasMicPermission(true);
      addLog('success', 'Microphone permission granted');
      return true;
    } catch (error) {
      setHasMicPermission(false);
      addLog(
        'error',
        `Mic permission denied: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }, [addLog]);

  // ─── Start Recording ──────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    if (!clientRef.current) {
      addLog('error', 'SDK not initialized');
      return;
    }

    setIsLoading(true);

    const hasPermission = await requestMicPermission();
    if (!hasPermission) {
      setIsLoading(false);
      return;
    }

    addLog('info', 'Starting recording...');

    const result: SDKResult<CreateSessionResponse> = await clientRef.current.startRecording({
      templates: config.templates.split(',').map((t) => t.trim()),
      model: config.model || undefined,
      uploadType: 'chunked',
      communicationProtocol: 'http',
    });

    if (!result.success) {
      addLog('error', `Start failed: ${formatError(result.error)}`);
      setIsLoading(false);
      return;
    }

    setSessionInfo(result.data);
    setRecordingState('recording');
    setOutputStatus(null);
    setStopResult(null);
    startTimer();
    addLog('success', `Recording started — Session: ${result.data.session_id}`);
    setIsLoading(false);
  }, [config, addLog, formatError, requestMicPermission, startTimer]);

  // ─── Stop Recording ───────────────────────────────────────────────────────

  const stopRecording = useCallback(async () => {
    if (!clientRef.current) {
      addLog('error', 'SDK not initialized');
      return;
    }

    setIsLoading(true);
    addLog('info', 'Stopping recording...');

    const result: SDKResult<StopRecordingResult> = await clientRef.current.endRecording();

    if (!result.success) {
      addLog('error', `Stop failed: ${formatError(result.error)}`);
      setIsLoading(false);
      return;
    }

    setStopResult(result.data);
    setRecordingState('stopped');
    stopTimer();
    addLog(
      'success',
      `Recording stopped — ${result.data.totalFiles} files, ${result.data.failedUploads.length} failed`
    );

    if (result.data.failedUploads.length > 0) {
      addLog('error', `Failed uploads: ${result.data.failedUploads.join(', ')}`);
    }

    setIsLoading(false);
  }, [addLog, formatError, stopTimer]);

  // ─── Pause / Resume ───────────────────────────────────────────────────────

  const pauseRecording = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.pauseRecording();
    setRecordingState('paused');
    pauseTimer();
    addLog('success', 'Recording paused');
  }, [addLog, pauseTimer]);

  const resumeRecording = useCallback(() => {
    if (!clientRef.current) return;
    clientRef.current.resumeRecording();
    setRecordingState('recording');
    resumeTimer();
    addLog('success', 'Recording resumed');
  }, [addLog, resumeTimer]);

  // ─── Get Session Status ───────────────────────────────────────────────────

  const getSessionStatus = useCallback(async () => {
    if (!clientRef.current || !sessionInfo) {
      addLog('error', 'No active session');
      return;
    }

    setIsLoading(true);
    addLog('info', 'Fetching session status...');

    const result: SDKResult<GetSessionStatusResponse> = await clientRef.current.getSessionStatus(
      sessionInfo.session_id
    );

    if (!result.success) {
      addLog('error', `Status failed: ${formatError(result.error)}`);
      setIsLoading(false);
      return;
    }

    setOutputStatus(result.data);
    addLog('success', `Status: ${result.data.status}`);

    // Handle expired sessions (410 is returned as data, not error)
    if (result.data.status === SessionStatus.EXPIRED) {
      addLog('event', `Session expired at ${result.data.expires_at}`);
    }

    setIsLoading(false);
  }, [addLog, formatError, sessionInfo]);

  // ─── Poll for Completion ──────────────────────────────────────────────────

  const pollForCompletion = useCallback(async () => {
    if (!clientRef.current || !sessionInfo) {
      addLog('error', 'No active session');
      return;
    }

    setIsPolling(true);
    addLog('info', 'Polling for completion...');

    const result: SDKResult<GetSessionStatusResponse> = await clientRef.current.getSessionStatus(
      sessionInfo.session_id,
      {
        poll: {
          maxAttempts: 60,
          intervalMs: 2000,
          onProgress: (status) => {
            addLog('info', `Processing... status: ${status.status}`);
            setOutputStatus(status);
          },
        },
      }
    );

    if (!result.success) {
      addLog('error', `Polling failed: ${formatError(result.error)}`);
      setIsPolling(false);
      return;
    }

    setOutputStatus(result.data);

    if (result.data.status === SessionStatus.COMPLETED) {
      addLog('success', 'Processing complete!');
    } else if (result.data.status === SessionStatus.PARTIAL) {
      addLog('event', 'Partial results received');
    } else if (result.data.status === SessionStatus.FAILED) {
      addLog('error', `Processing failed: ${result.data.error?.message ?? 'Unknown'}`);
    } else if (result.data.status === SessionStatus.EXPIRED) {
      addLog('event', 'Session expired');
    }

    setIsPolling(false);
  }, [addLog, formatError, sessionInfo]);

  // ─── Reset ────────────────────────────────────────────────────────────────

  const resetSDK = useCallback(async () => {
    if (clientRef.current) {
      await clientRef.current.reset();
      clientRef.current = null;
    }
    setIsInitialized(false);
    setRecordingState('idle');
    setSessionInfo(null);
    setStopResult(null);
    setOutputStatus(null);
    resetTimer();
    addLog('info', 'SDK reset');
  }, [addLog, resetTimer]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="app">
      <header className="header">
        <h1>MedScribe SDK Demo</h1>
        <p className="subtitle">Integration example for med-scribe-alliance-ts-sdk</p>
      </header>

      <main className="main">
        {/* Configuration Section */}
        <section className="section config-section">
          <h2>Configuration</h2>
          <div className="config-form">
            <div className="form-group">
              <label htmlFor="baseUrl">Base URL *</label>
              <input
                id="baseUrl"
                type="text"
                value={config.baseUrl}
                onChange={(e) => setConfig((c) => ({ ...c, baseUrl: e.target.value }))}
                placeholder="https://api.eka.care/voice/api/v2"
                disabled={isInitialized}
              />
            </div>
            <div className="form-group">
              <label htmlFor="accessToken">Access Token</label>
              <input
                id="accessToken"
                type="password"
                value={config.accessToken}
                onChange={(e) => setConfig((c) => ({ ...c, accessToken: e.target.value }))}
                placeholder="Bearer token (optional)"
                disabled={isInitialized}
              />
            </div>
            <div className="form-group">
              <label htmlFor="templates">Templates (comma-separated)</label>
              <input
                id="templates"
                type="text"
                value={config.templates}
                onChange={(e) => setConfig((c) => ({ ...c, templates: e.target.value }))}
                placeholder="soap, prescription"
                disabled={recordingState === 'recording'}
              />
            </div>
            <div className="form-group">
              <label htmlFor="model">Model (optional)</label>
              <input
                id="model"
                type="text"
                value={config.model}
                onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
                placeholder="Leave empty for default"
                disabled={recordingState === 'recording'}
              />
            </div>
            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={config.debug}
                  onChange={(e) => setConfig((c) => ({ ...c, debug: e.target.checked }))}
                  disabled={isInitialized}
                />
                Debug Mode
              </label>
            </div>
          </div>
          <div className="button-row">
            {!isInitialized ? (
              <button
                className="btn btn-primary"
                onClick={initializeSDK}
                disabled={isLoading || !config.baseUrl}
              >
                {isLoading ? 'Initializing...' : 'Initialize SDK'}
              </button>
            ) : (
              <button
                className="btn btn-secondary"
                onClick={resetSDK}
                disabled={isLoading || recordingState === 'recording'}
              >
                Reset SDK
              </button>
            )}
          </div>
        </section>

        {/* Recording Controls */}
        <section className="section controls-section">
          <h2>Recording Controls</h2>
          <div className="status-badge">
            Status:{' '}
            <span className={`badge badge-${recordingState}`}>{recordingState.toUpperCase()}</span>
            {(recordingState === 'recording' ||
              recordingState === 'paused' ||
              recordingState === 'stopped') && (
              <span
                className="timer"
                style={{ marginLeft: '16px', fontFamily: 'monospace', fontSize: '1.2em' }}
              >
                {formatTime(elapsedTime)}
              </span>
            )}
          </div>
          <div className="button-row controls">
            <button
              className="btn btn-success"
              onClick={startRecording}
              disabled={!isInitialized || isLoading || recordingState === 'recording'}
            >
              Start Recording
            </button>
            <button
              className="btn btn-warning"
              onClick={pauseRecording}
              disabled={!isInitialized || recordingState !== 'recording'}
            >
              Pause
            </button>
            <button
              className="btn btn-info"
              onClick={resumeRecording}
              disabled={!isInitialized || recordingState !== 'paused'}
            >
              Resume
            </button>
            <button
              className="btn btn-danger"
              onClick={stopRecording}
              disabled={
                !isInitialized ||
                isLoading ||
                (recordingState !== 'recording' && recordingState !== 'paused')
              }
            >
              Stop Recording
            </button>
          </div>
          <p className="hint">Microphone permission will be requested when you start recording.</p>
        </section>

        {/* Output Section */}
        <section className="section output-section">
          <h2>Output</h2>
          <div className="button-row">
            <button
              className="btn btn-primary"
              onClick={getSessionStatus}
              disabled={!isInitialized || isLoading || !sessionInfo}
            >
              Get Session Status
            </button>
            <button
              className="btn btn-secondary"
              onClick={pollForCompletion}
              disabled={
                !isInitialized || isPolling || !sessionInfo || recordingState === 'recording'
              }
            >
              {isPolling ? 'Polling...' : 'Poll for Completion'}
            </button>
          </div>

          {sessionInfo && (
            <div className="info-card">
              <h3>Session Info</h3>
              <pre>{JSON.stringify(sessionInfo, null, 2)}</pre>
            </div>
          )}

          {stopResult && (
            <div className="info-card">
              <h3>Stop Result</h3>
              <pre>{JSON.stringify(stopResult, null, 2)}</pre>
            </div>
          )}

          {outputStatus && (
            <div className="info-card">
              <h3>Session Status</h3>
              <pre>{JSON.stringify(outputStatus, null, 2)}</pre>
            </div>
          )}
        </section>

        {/* Logs Section */}
        <section className="section logs-section">
          <div className="logs-header">
            <h2>Logs</h2>
            <button className="btn btn-small" onClick={clearLogs}>
              Clear
            </button>
          </div>
          <div className="logs-container">
            {logs.map((log, index) => (
              <div key={index} className={`log-entry log-${log.type}`}>
                <span className="log-time">{log.timestamp.toLocaleTimeString()}</span>
                <span className="log-type">[{log.type.toUpperCase()}]</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>MedScribe Alliance TS SDK — Demo App</p>
      </footer>
    </div>
  );
}

export default App;
