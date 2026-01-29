export type UploadResponse = {
  success?: string;
  error?: string;
  code?: number;
};

export type RetryOptions = {
  maxRetries?: number;
  delay?: number;
};

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_DELAY = 2000;

/**
 * Generic retry wrapper for async operations
 * @param fn - The async function to retry
 * @param options - Retry options (maxRetries, delay)
 * @returns Promise resolving to the function result
 */
export async function retryWrapper<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = DEFAULT_MAX_RETRIES, delay = DEFAULT_DELAY } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      console.log(`Upload attempt ${attempt + 1} failed:`, error?.message || error);

      // Don't retry on 4xx client errors (except 408 Request Timeout and 429 Too Many Requests)
      const statusCode = error?.statusCode || error?.code;
      if (
        typeof statusCode === 'number' &&
        statusCode >= 400 &&
        statusCode < 500 &&
        statusCode !== 408 &&
        statusCode !== 429
      ) {
        throw error;
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Upload failed after retries');
}

/**
 * Upload a file using multipart/form-data with retry logic
 * @param uploadUrl - The URL to upload to
 * @param fileName - The name of the file
 * @param fileBlob - The file blob to upload
 * @param headers - Optional additional headers
 * @param retryOptions - Optional retry configuration
 * @returns Promise resolving to upload response
 */
export async function uploadFileWithFormData(
  uploadUrl: string,
  fileName: string,
  fileBlob: Blob,
  headers?: Record<string, string>,
  retryOptions?: RetryOptions
): Promise<UploadResponse> {
  const uploadFn = async (): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('file', fileBlob, fileName);

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
      headers: {
        // Note: Don't set Content-Type header - browser will set it with boundary for FormData
        ...(headers || {}),
      },
    });

    if (!response.ok) {
      const error: any = new Error(response.statusText || 'Upload failed');
      error.statusCode = response.status;
      throw error;
    }

    const etag = response.headers.get('ETag');
    return { success: etag || 'Upload successful' };
  };

  try {
    return await retryWrapper(uploadFn, retryOptions);
  } catch (error: any) {
    return {
      error: error.message || 'Network error',
      code: error.statusCode || 0,
    };
  }
}
