/**
 * Example: Error Handling
 * Demonstrates proper error handling with typed errors
 */

import {
  ScribeClient,
  ScribeError,
  AuthenticationError,
  SessionNotFoundError,
  SessionExpiredError,
  RateLimitError,
  ValidationError,
} from '../src';

async function errorHandlingExample() {
  const client = new ScribeClient({
    apiKey: 'sk_live_your_api_key_here',
    baseUrl: 'https://api.scribe.example.com',
  });

  try {
    await client.init();

    // Example 1: Validation error - missing templates
    try {
      await client.startRecording({
        templates: [], // Invalid: empty array
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        console.log('Validation Error:', error.message);
        console.log('Error code:', error.code);
      }
    }

    // Example 2: Session not found
    try {
      await client.getOutputStatus('ses_invalid_id');
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        console.log('Session Not Found:', error.message);
        console.log('Details:', error.details);
      }
    }

    // Example 3: Generic error handling
    try {
      const session = await client.startRecording({
        templates: ['soap'],
        model: 'invalid_model', // This might fail validation
      });
    } catch (error) {
      if (error instanceof AuthenticationError) {
        console.error('Authentication failed - check your API key');
      } else if (error instanceof RateLimitError) {
        console.error('Rate limited - retry after:', error.details?.retry_after_seconds);
      } else if (error instanceof SessionExpiredError) {
        console.error('Session expired at:', error.details?.expired_at);
      } else if (error instanceof ValidationError) {
        console.error('Validation error:', error.message);
      } else if (error instanceof ScribeError) {
        console.error('Scribe error:', error.code, error.message);
        console.error('HTTP status:', error.httpStatus);
        console.error('Details:', error.details);
      } else {
        console.error('Unexpected error:', error);
      }
    }

    // Example 4: Handling partial results
    const session = await client.startRecording({
      templates: ['soap', 'medications', 'vitals'],
    });

    // ... upload audio ...

    await client.endRecording();
    const result = await client.pollForCompletion(session.session_id);

    if (result.status === 'partial') {
      console.log('⚠ Partial results received');

      // Check which templates succeeded and which failed
      if (result.templates) {
        Object.entries(result.templates).forEach(([templateId, template]) => {
          if (template.status === 'success') {
            console.log(`✓ ${templateId}: Success`);
          } else {
            console.log(`✗ ${templateId}: Failed - ${template.error?.message}`);
          }
        });
      }

      // Check processing errors
      if (result.processing_errors) {
        console.log('\nProcessing errors:');
        result.processing_errors.forEach((error) => {
          console.log(`  - ${error.type}: ${error.message}`);
        });
      }
    } else if (result.status === 'failed') {
      console.error('✗ Session failed');
      console.error('Error:', result.error?.message);
    } else {
      console.log('✓ Session completed successfully');
    }
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

// Run the example
errorHandlingExample();
