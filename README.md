
# Scribe EMR Protocol SDK

A TypeScript SDK for the [MedScribe Alliance Protocol](https://github.com/MedScribeAlliance/scribe-emr-protocol), providing a clean and type-safe interface for medical transcription services.

## Features

- ✅ **Protocol Compliant**: Fully implements the MedScribe Alliance Protocol specification
- ✅ **Type-Safe**: Complete TypeScript definitions for all API interactions
- ✅ **Auto-Discovery**: Automatic service capability discovery via well-known endpoint
- ✅ **Schema Validation**: AJV-powered validation against OpenAPI schemas
- ✅ **Error Handling**: Comprehensive error handling with typed error codes
- ✅ **Event System**: Built-in event emitter for session lifecycle events
- ✅ **Polling Support**: Automatic polling for session completion

## Installation

```bash
npm install scribe-standard-sdk
```

## Quick Start

```typescript
import { ScribeClient } from 'scribe-standard-sdk';

// Initialize the SDK
const client = new ScribeClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.scribe.example.com',
  debug: true, // Optional: enable debug logging
});

// Initialize (performs discovery)
await client.init();

// Start a recording session
const session = await client.startRecording({
  templates: ['soap', 'medications'],
  languageHint: ['en'],
  model: 'pro',
});

console.log('Session created:', session.session_id);
console.log('Upload audio to:', session.upload_url);

// ... Upload audio chunks to session.upload_url ...

// End the recording session
const endResponse = await client.endRecording();
console.log('Session ended, processing started');

// Poll for completion
const result = await client.pollForCompletion(session.session_id, {
  maxAttempts: 60,
  intervalMs: 2000,
  onProgress: (status) => {
    console.log('Status:', status.status);
  },
});

// Access the results
if (result.status === 'completed') {
  console.log('Transcript:', result.transcript);
  console.log('Templates:', result.templates);
}
```

## Core API

### ScribeClient

The main SDK client class.

#### Constructor

```typescript
new ScribeClient(config: ScribeSDKConfig)
```

**Config Options:**
- `apiKey` (required): Your API key for authentication
- `baseUrl` (optional): Base URL of the Scribe service
- `debug` (optional): Enable debug logging (default: `false`)
- `autoDiscovery` (optional): Auto-fetch service capabilities (default: `true`)

#### Methods

##### `init(): Promise<void>`

Initialize the SDK and perform service discovery.

```typescript
await client.init();
```

##### `startRecording(options: RecordingOptions): Promise<CreateSessionResponse>`

Start a new recording session.

**Options:**
- `templates` (required): Array of template IDs to extract (e.g., `['soap', 'medications']`)
- `model` (optional): Model ID from discovery
- `languageHint` (optional): Array of ISO 639-1 language codes for audio input (e.g., `['en', 'es']`)
- `transcriptLanguage` (optional): Array of ISO 639-1 codes for transcript output (e.g., `['en']`)
- `uploadType` (optional): `'chunked'` or `'single'`
- `communicationProtocol` (optional): `'http'`, `'websocket'`, or `'rpc'` (default: `'http'`)
- `additionalData` (optional): Pass-through data for your application

**Returns:**
- `session_id`: Unique session identifier
- `status`: Session status (`'created'`)
- `created_at`: ISO 8601 timestamp
- `expires_at`: ISO 8601 expiry timestamp
- `upload_url`: URL for uploading audio

```typescript
const session = await client.startRecording({
  templates: ['soap'],
  languageHint: ['en'],
  transcriptLanguage: ['en'],
  additionalData: {
    patient_id: 'pat_123',
    encounter_id: 'enc_456',
  },
});
```

##### `endRecording(): Promise<EndSessionResponse>`

End the current recording session and trigger processing.

```typescript
const response = await client.endRecording();
```

##### `getOutputStatus(sessionId?: string): Promise<GetSessionStatusResponse>`

Get the current status and results of a session.

```typescript
const status = await client.getOutputStatus(session.session_id);

if (status.status === 'completed') {
  console.log('Transcript:', status.transcript);
  console.log('Templates:', status.templates);
}
```

**Session Status Values:**
- `created`: Session created, awaiting audio
- `processing`: Audio is being processed
- `completed`: Processing complete, all templates successful
- `partial`: Processing complete, some templates failed
- `failed`: Processing failed completely

##### `pollForCompletion(sessionId?, options?): Promise<GetSessionStatusResponse>`

Poll for session completion with automatic retries.

```typescript
const result = await client.pollForCompletion(session.session_id, {
  maxAttempts: 60,      // Maximum polling attempts
  intervalMs: 2000,     // Interval between polls (ms)
  onProgress: (status) => {
    console.log('Current status:', status.status);
  },
});
```

##### `getCurrentSession(): CreateSessionResponse | null`

Get the current active session.

```typescript
const currentSession = client.getCurrentSession();
```

##### `getDiscoveryDocument(): DiscoveryDocument | null`

Get the cached discovery document.

```typescript
const discovery = client.getDiscoveryDocument();
console.log('Supported models:', discovery?.models);
console.log('Supported languages:', discovery?.languages.supported);
```

## Event System

The SDK emits events for session lifecycle tracking.

```typescript
client.on('discovery:complete', (event) => {
  console.log('Discovery complete:', event.data);
});

client.on('session:created', (event) => {
  console.log('Session created:', event.data);
});

client.on('session:ended', (event) => {
  console.log('Session ended:', event.data);
});

client.on('session:status_update', (event) => {
  console.log('Status update:', event.data);
});

client.on('error', (event) => {
  console.error('Error:', event.error);
});
```

## Schema Validation

The SDK automatically validates all API requests against the OpenAPI schema using AJV. This ensures that:

- Request bodies conform to the expected structure
- Required fields are present
- Field types match the specification
- Session IDs follow the correct pattern (`ses_[a-zA-Z0-9]+`)
- Enum values are valid (e.g., `model`, `upload_type`, `communication_protocol`)

Validation happens automatically before any API call:

```typescript
// This will throw a ValidationError if the request is invalid
try {
  const session = await client.startRecording({
    templates: ['soap', 'medications'],
    model: 'invalid-model', // ❌ Will fail validation if not in enum
    uploadType: 'chunked',
  });
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Validation failed:', error.message);
    // Example: "Validation failed for CreateSessionRequest:
    //           - /model: must be equal to one of the allowed values (allowed values: pro, lite)"
  }
}
```

**Validated Operations:**
- `createSession()`: Validates request body against `CreateSessionRequest` schema
- `getSessionStatus()`: Validates session ID format
- `endSession()`: Validates session ID format
- `pollSessionStatus()`: Validates session ID format

You can also use the validator directly for custom validation:

```typescript
import { schemaValidator } from 'scribe-standard-sdk/utils/validator';

// Validate a session ID
try {
  schemaValidator.validateSessionId('ses_abc123');
} catch (error) {
  console.error('Invalid session ID:', error.message);
}

// Validate a create session request
try {
  schemaValidator.validateCreateSessionRequest({
    templates: ['soap'],
    upload_type: 'chunked',
    communication_protocol: 'http',
  });
} catch (error) {
  console.error('Invalid request:', error.message);
}
```

## Error Handling

The SDK provides typed error classes for different error scenarios:

```typescript
import {
  ScribeError,
  AuthenticationError,
  SessionNotFoundError,
  SessionExpiredError,
  RateLimitError,
  ValidationError,
} from 'scribe-standard-sdk';

try {
  await client.startRecording({ templates: ['soap'] });
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Validation error:', error.message);
  } else if (error instanceof AuthenticationError) {
    console.error('Authentication failed:', error.message);
  } else if (error instanceof SessionExpiredError) {
    console.error('Session expired:', error.details);
  } else if (error instanceof RateLimitError) {
    console.error('Rate limited, retry after:', error.details?.retry_after_seconds);
  } else if (error instanceof ScribeError) {
    console.error('Scribe error:', error.code, error.message);
  }
}
```

## Template Output

When a session completes, the `templates` field contains the extracted data:

```typescript
const status = await client.getOutputStatus(sessionId);

if (status.templates) {
  // Check SOAP template
  const soap = status.templates['soap'];
  if (soap.status === 'success') {
    console.log('SOAP Note:', soap.data);
  } else {
    console.error('SOAP extraction failed:', soap.error);
  }

  // Check medications template
  const meds = status.templates['medications'];
  if (meds.status === 'success') {
    console.log('Medications:', meds.data);
  }
}
```

## Discovery Document

The discovery document provides service capabilities:

```typescript
const discovery = client.getDiscoveryDocument();

// Check supported audio formats
console.log('Audio formats:', discovery.capabilities.audio_formats);

// Check max chunk duration
console.log('Max chunk duration:', discovery.capabilities.max_chunk_duration_seconds);

// Check available models
discovery.models.forEach((model) => {
  console.log(`Model: ${model.id}`);
  console.log(`  Languages: ${model.languages.join(', ')}`);
  console.log(`  Max duration: ${model.max_session_duration_seconds}s`);
  console.log(`  Features:`, model.features);
});
```

## TypeScript Support

The SDK is written in TypeScript and provides full type definitions:

```typescript
import type {
  ScribeSDKConfig,
  RecordingOptions,
  CreateSessionResponse,
  GetSessionStatusResponse,
  TemplatesOutput,
  DiscoveryDocument,
} from 'scribe-standard-sdk';
```

## Protocol Compliance

This SDK implements the following specifications:

- **Spec 04**: Discovery - Service capability discovery via well-known endpoint
- **Spec 06**: Session Lifecycle - Create, get status, and end sessions
- **Spec 09**: Extraction & Response - Template output and transcript handling
- **Spec 11**: Error Handling - Standard error codes and HTTP status mapping

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

