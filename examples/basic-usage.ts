/**
 * Example: Basic Usage
 * Demonstrates the core SDK functionality
 */

import { ScribeClient } from '../src';

async function basicExample() {
  // Initialize the client
  const client = new ScribeClient({
    apiKey: 'sk_live_your_api_key_here',
    baseUrl: 'https://api.scribe.example.com',
    debug: true,
  });

  try {
    // Step 1: Initialize (performs discovery)
    console.log('Initializing SDK...');
    await client.init();

    // Check discovery information
    const discovery = client.getDiscoveryDocument();
    console.log('Service:', discovery?.service.name);
    console.log('Supported models:', discovery?.models.map((m) => m.id));
    console.log('Supported languages:', discovery?.languages.supported);

    // Step 2: Start recording
    console.log('\nStarting recording session...');
    const session = await client.startRecording({
      templates: ['soap', 'medications'],
      languageHint: 'en',
      model: 'pro',
      additionalData: {
        patient_id: 'pat_12345',
        encounter_id: 'enc_67890',
      },
    });

    console.log('Session created:', session.session_id);
    console.log('Upload URL:', session.upload_url);
    console.log('Expires at:', session.expires_at);

    // Step 3: Audio upload would happen here
    // (Skipped as per requirements - assume audio is uploaded externally)
    console.log('\n[Audio upload happens here...]');

    // Step 4: End recording
    console.log('\nEnding recording session...');
    const endResponse = await client.endRecording();
    console.log('Session ended:', endResponse.message);
    console.log('Audio files received:', endResponse.audio_files_received);

    // Step 5: Poll for completion
    console.log('\nPolling for completion...');
    const result = await client.pollForCompletion(session.session_id, {
      maxAttempts: 60,
      intervalMs: 2000,
      onProgress: (status) => {
        console.log(`  Status: ${status.status}`);
      },
    });

    // Step 6: Process results
    console.log('\n=== RESULTS ===');
    console.log('Final status:', result.status);
    console.log('Model used:', result.model_used);
    console.log('Language detected:', result.language_detected);

    if (result.transcript) {
      console.log('\nTranscript:');
      console.log(result.transcript);
    }

    if (result.templates) {
      console.log('\nTemplate Results:');
      Object.entries(result.templates).forEach(([templateId, template]) => {
        console.log(`\n${templateId}:`);
        if (template.status === 'success') {
          console.log('  Status: ✓ Success');
          console.log('  Data:', JSON.stringify(template.data, null, 2));
        } else {
          console.log('  Status: ✗ Failed');
          console.log('  Error:', template.error?.message);
        }
      });
    }

    // Cleanup
    client.clearSession();
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
basicExample();
