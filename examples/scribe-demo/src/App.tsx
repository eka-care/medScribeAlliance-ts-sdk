import { useState, useCallback, useRef, useEffect } from 'react';
import { ScribeClient, UploadType } from 'med-scribe-alliance-ts-sdk';
import type {
  RecordingOptions,
  GetSessionStatusResponse,
  CreateSessionResponse,
  SDKEvent,
} from 'med-scribe-alliance-ts-sdk';
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
  const [outputStatus, setOutputStatus] = useState<GetSessionStatusResponse | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [, setHasMicPermission] = useState<boolean | null>(null);

  // Configuration
  const [config, setConfig] = useState({
    baseUrl: '',
    apiKey: '',
    templates: 'soap',
    model: '',
    debug: true,
  });

  // Refs
  const clientRef = useRef<ScribeClient | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Add log entry
  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLogs((prev) => [...prev, { timestamp: new Date(), type, message }]);
  }, []);

  // Initialize SDK
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

      console.log('Creating ScribeClient with config:', config);

      const client = new ScribeClient({
        baseUrl: config.baseUrl,
      });

      // Setup event listeners
      client.on('discovery:complete', (event: SDKEvent) => {
        addLog('event', `Discovery complete: ${JSON.stringify(event.data?.service || {})}`);
      });

      client.on('session:created', (event: SDKEvent) => {
        addLog('event', `Session created: ${event.data?.session_id}`);
      });

      client.on('session:ended', (event: SDKEvent) => {
        addLog('event', `Session ended: ${event.data?.session_id}`);
      });

      client.on('session:status_update', (event: SDKEvent) => {
        addLog('event', `Status update: ${event.data?.status}`);
      });

      client.on('error', (event: SDKEvent) => {
        addLog('error', `SDK Error: ${event.error?.message || 'Unknown error'}`);
      });

      await client.init();
      clientRef.current = client;
      setIsInitialized(true);
      addLog('success', 'SDK initialized successfully');
    } catch (error) {
      addLog(
        'error',
        `Failed to initialize SDK: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsLoading(false);
    }
  }, [config, addLog]);

  // Request microphone permission
  const requestMicPermission = useCallback(async (): Promise<boolean> => {
    try {
      addLog('info', 'Requesting microphone permission...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop tracks immediately - we just needed to request permission
      stream.getTracks().forEach((track) => track.stop());
      setHasMicPermission(true);
      addLog('success', 'Microphone permission granted');
      return true;
    } catch (error) {
      setHasMicPermission(false);
      addLog(
        'error',
        `Microphone permission denied: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }, [addLog]);

  // Start Recording
  const startRecording = useCallback(async () => {
    if (!clientRef.current) {
      addLog('error', 'SDK not initialized');
      return;
    }

    setIsLoading(true);

    // Request microphone permission first
    const hasPermission = await requestMicPermission();
    if (!hasPermission) {
      setIsLoading(false);
      return;
    }

    addLog('info', 'Starting recording...');

    try {
      const options: RecordingOptions = {
        templates: config.templates.split(',').map((t) => t.trim()),
        model: config.model || undefined,
        uploadType: UploadType.CHUNKED,
        communicationProtocol: 'http',
      };

      const session = await clientRef.current.startRecording(options);
      setSessionInfo(session);
      setRecordingState('recording');
      setOutputStatus(null);
      addLog('success', `Recording started - Session ID: ${session.session_id}`);
    } catch (error) {
      addLog(
        'error',
        `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsLoading(false);
    }
  }, [config, addLog, requestMicPermission]);

  // Stop Recording
  const stopRecording = useCallback(async () => {
    if (!clientRef.current) {
      addLog('error', 'SDK not initialized');
      return;
    }

    setIsLoading(true);
    addLog('info', 'Stopping recording...');

    try {
      const response = await clientRef.current.endRecording();
      setRecordingState('stopped');
      addLog('success', `Recording stopped - Files received: ${response.audio_files_received}`);
    } catch (error) {
      addLog(
        'error',
        `Failed to stop recording: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsLoading(false);
    }
  }, [addLog]);

  // Pause Recording
  const pauseRecording = useCallback(() => {
    if (!clientRef.current) {
      addLog('error', 'SDK not initialized');
      return;
    }

    try {
      clientRef.current.pauseRecording();
      setRecordingState('paused');
      addLog('success', 'Recording paused');
    } catch (error) {
      addLog('error', `Failed to pause: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [addLog]);

  // Resume Recording
  const resumeRecording = useCallback(() => {
    if (!clientRef.current) {
      addLog('error', 'SDK not initialized');
      return;
    }

    try {
      clientRef.current.resumeRecording();
      setRecordingState('recording');
      addLog('success', 'Recording resumed');
    } catch (error) {
      addLog(
        'error',
        `Failed to resume: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [addLog]);

  // Get Output Status
  const getOutputStatus = useCallback(async () => {
    if (!clientRef.current) {
      addLog('error', 'SDK not initialized');
      return;
    }

    setIsLoading(true);
    addLog('info', 'Fetching output status...');

    try {
      const status = await clientRef.current.getOutputStatus();
      setOutputStatus(status);
      addLog('success', `Status: ${status.status}`);
    } catch (error) {
      addLog(
        'error',
        `Failed to get status: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsLoading(false);
    }
  }, [addLog]);

  // Poll for completion
  const pollForCompletion = useCallback(async () => {
    if (!clientRef.current) {
      addLog('error', 'SDK not initialized');
      return;
    }

    setIsPolling(true);
    addLog('info', 'Polling for completion...');

    try {
      const status = await clientRef.current.pollForCompletion(undefined, {
        maxAttempts: 60,
        intervalMs: 2000,
        onProgress: (s) => {
          addLog('info', `Processing... Status: ${s.status}`);
          setOutputStatus(s);
        },
      });
      setOutputStatus(status);
      addLog('success', 'Processing complete!');
    } catch (error) {
      addLog('error', `Polling failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsPolling(false);
    }
  }, [addLog]);

  // Reset
  const resetSDK = useCallback(async () => {
    if (clientRef.current) {
      await clientRef.current.reset();
      clientRef.current = null;
    }
    setIsInitialized(false);
    setRecordingState('idle');
    setSessionInfo(null);
    setOutputStatus(null);
    addLog('info', 'SDK reset');
  }, [addLog]);

  // Clear logs
  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

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
                placeholder="https://api.example.com"
                disabled={isInitialized}
              />
            </div>
            <div className="form-group">
              <label htmlFor="apiKey">API Key</label>
              <input
                id="apiKey"
                type="password"
                value={config.apiKey}
                onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
                placeholder="Optional"
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
              onClick={getOutputStatus}
              disabled={!isInitialized || isLoading || !sessionInfo}
            >
              Get Output Status
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

          {outputStatus && (
            <div className="info-card">
              <h3>Output Status</h3>
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
        <p>
          SDK Package:{' '}
          <a
            href="https://www.npmjs.com/package/med-scribe-alliance-ts-sdk"
            target="_blank"
            rel="noopener noreferrer"
          >
            med-scribe-alliance-ts-sdk
          </a>
        </p>
      </footer>
    </div>
  );
}

export default App;
