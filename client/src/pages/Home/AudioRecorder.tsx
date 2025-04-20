import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { BACKEND_URL } from "Shared/constants";

// Map status codes to user-friendly labels
const STATUS_LABELS: Record<string, string> = {
  audio_processing_started: "Processing audio...",
  transcription_complete: "Transcribing the audio...",
  details_extracted: "Extracting relevant details...",
  text_generated: "Generating SOAP note...",
  completed: "Processing complete",
  error: "An error occurred",
};

// Define polling interval in milliseconds
const POLLING_INTERVAL = 3000;

interface PollingItem {
  id: number;
  status: string;
  completed: boolean;
  error: string | null;
  success: boolean | null;
  created_at: string;
  updated_at: string;
}

interface Visit {
  id: number;
  audio_file: string | null;
  transcript_text: string | null;
  transcript_json: object | null;
  draft_soap_note: string | null;
  final_soap_note: string | null;
  created_at: string;
  updated_at: string;
  pollings: PollingItem[];
}

const AudioRecorder: React.FC = () => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [pollingItems, setPollingItems] = useState<PollingItem[]>([]);
  const [processingComplete, setProcessingComplete] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<boolean>(false);
  const [visit, setVisit] = useState<Visit | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setProcessingComplete(false);
      setProcessingError(false);
      setPollingItems([]);
      setVisit(null);

      // First get a visit ID from the backend
      const response = await axios.post(`${BACKEND_URL}/rest/visits`);
      const newVisitId = response.data.id.toString();
      setVisitId(newVisitId);

      // Once we have the visit ID, start recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create MediaRecorder with preferred codec
      const options = {
        mimeType: getSupportedMimeType(),
      };

      const mediaRecorder = new MediaRecorder(stream, options);

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Start timer
      setRecordingTime(0);
      timerIntervalRef.current = window.setInterval(() => {
        setRecordingTime((prevTime) => prevTime + 1);
      }, 1000);

      mediaRecorder.start(1000); // Collect data in 1-second chunks
      setIsLoading(false);
      setIsRecording(true);
    } catch (err) {
      setIsLoading(false);
      setError(`Failed to start recording: ${err instanceof Error ? err.message : String(err)}`);
      console.error("Error starting recording:", err);
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || !visitId) return;

    try {
      // Stop the media recorder
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsLoading(true);

      // Clear timer
      if (timerIntervalRef.current !== null) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      // Wait for the final chunk to be processed
      await new Promise<void>((resolve) => {
        if (mediaRecorderRef.current) {
          mediaRecorderRef.current.onstop = () => resolve();
        } else {
          resolve();
        }
      });

      // Create a blob from all the chunks
      const mimeType = getSupportedMimeType();
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

      // Upload the audio and start polling
      await uploadAudio(audioBlob, visitId);

      // Clean up the media recorder and audio track
      const tracks = mediaRecorderRef.current.stream.getTracks();
      tracks.forEach((track) => track.stop());

      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
    } catch (err) {
      setIsLoading(false);
      setIsProcessing(false);
      setError(`Failed to process recording: ${err instanceof Error ? err.message : String(err)}`);
      console.error("Error processing recording:", err);
    }
  };

  const uploadAudio = async (audioBlob: Blob, visitId: string) => {
    try {
      setIsProcessing(true);

      // Create FormData to send the audio file
      const formData = new FormData();
      formData.append("audio", audioBlob, `recording-${visitId}.${getFileExtension(audioBlob.type)}`);

      // Send the audio to the backend
      await axios.post(`${BACKEND_URL}/rest/visits/${visitId}/audio`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      // Start polling for status updates
      startPolling(visitId);

      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setIsProcessing(false);
      setError(`Failed to upload audio: ${err instanceof Error ? err.message : String(err)}`);
      console.error("Error uploading audio:", err);
    }
  };

  const startPolling = (visitId: string) => {
    // Clear any existing polling interval
    if (pollingIntervalRef.current !== null) {
      clearInterval(pollingIntervalRef.current);
    }

    // Function to poll the API
    const pollStatus = async () => {
      try {
        const response = await axios.get(`${BACKEND_URL}/rest/visits/${visitId}`);
        const visitData: Visit = response.data;
        setVisit(visitData);

        // Update polling items
        if (visitData.pollings) {
          setPollingItems(visitData.pollings);

          // Check if processing is complete or has error
          const hasCompleted = visitData.pollings.some((item) => item.status === "completed");
          const hasError = visitData.pollings.some((item) => item.status === "error");

          if (hasCompleted) {
            setProcessingComplete(true);
            setIsProcessing(false);
            clearInterval(pollingIntervalRef.current!);
            pollingIntervalRef.current = null;
          } else if (hasError) {
            setProcessingError(true);
            setIsProcessing(false);
            clearInterval(pollingIntervalRef.current!);
            pollingIntervalRef.current = null;

            // Get the error message
            const errorItem = visitData.pollings.find((item) => item.status === "error");
            if (errorItem && errorItem.error) {
              setError(errorItem.error);
            } else {
              setError("An error occurred during processing.");
            }
          }
        }
      } catch (err) {
        console.error("Error polling status:", err);
        // Don't stop polling on error, just log it
      }
    };

    // Poll immediately and then at regular intervals
    pollStatus();
    pollingIntervalRef.current = window.setInterval(pollStatus, POLLING_INTERVAL);
  };

  const handleButtonClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Function to get supported MIME type for optimal compression
  const getSupportedMimeType = (): string => {
    const possibleTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4;codecs=opus", "audio/mpeg"];

    for (const type of possibleTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return "audio/webm"; // Fallback
  };

  // Function to get file extension from mime type
  const getFileExtension = (mimeType: string): string => {
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("mpeg")) return "mp3";
    return "webm"; // Default
  };

  // Handle direct file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      setError(null);
      setProcessingComplete(false);
      setProcessingError(false);
      setPollingItems([]);
      setVisit(null);

      // First get a visit ID from the backend if we don't have one
      let currentVisitId = visitId;
      if (!currentVisitId) {
        const response = await axios.post(`${BACKEND_URL}/rest/visits`);
        currentVisitId = response.data.id.toString();
        setVisitId(currentVisitId);
      }

      // Upload the file and start polling
      await uploadAudio(file, currentVisitId!);

      setIsUploading(false);

      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      setIsUploading(false);
      setIsProcessing(false);
      setError(`Failed to upload file: ${err instanceof Error ? err.message : String(err)}`);
      console.error("Error uploading file:", err);
    }
  };

  // Clean up function when component unmounts
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) {
        const tracks = mediaRecorderRef.current.stream.getTracks();
        tracks.forEach((track) => track.stop());
      }

      if (timerIntervalRef.current !== null) {
        clearInterval(timerIntervalRef.current);
      }

      if (pollingIntervalRef.current !== null) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  // Get unique statuses in order of creation
  const getUniqueStatuses = (): string[] => {
    if (!pollingItems || pollingItems.length === 0) return [];

    const statuses = new Set<string>();

    // Sort by created_at to ensure correct order
    const sortedItems = [...pollingItems].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    sortedItems.forEach((item) => statuses.add(item.status));
    return Array.from(statuses);
  };

  // Get the most recent status
  const getCurrentStatus = (): string => {
    if (!pollingItems || pollingItems.length === 0) return "";

    // Sort by created_at in descending order to get the most recent
    const sortedItems = [...pollingItems].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return sortedItems[0].status;
  };

  const uniqueStatuses = getUniqueStatuses();
  const currentStatus = getCurrentStatus();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="card bg-base-100 shadow-xl w-full max-w-md">
        <div className="card-body">
          <h2 className="card-title justify-center">Audio Recorder</h2>

          {visitId && <div className="text-sm opacity-70 text-center">Visit ID: {visitId}</div>}

          {isRecording && (
            <div className="flex flex-col items-center mt-4 mb-2">
              <div className="badge badge-primary text-lg py-3 px-4">{formatTime(recordingTime)}</div>

              <div className="mt-4 flex justify-center">
                <div className="flex items-end space-x-1 h-12">
                  {[...Array(12)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-primary rounded-full animate-pulse"
                      style={{
                        height: `${20 + Math.floor(Math.random() * 60)}%`,
                        animationDelay: `${i * 0.1}s`,
                      }}
                    ></div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Processing Steps UI */}
          {isProcessing && uniqueStatuses.length > 0 && (
            <div className="my-4">
              <ul className="steps steps-vertical w-full">
                {Object.keys(STATUS_LABELS).map((status) => {
                  const isCompleted = uniqueStatuses.includes(status);
                  const isCurrent = currentStatus === status;

                  return (
                    <li key={status} className={`step ${isCompleted ? "step-primary" : ""}`} data-content={isCompleted && !isCurrent ? "✓" : isCurrent ? "●" : "○"}>
                      <div className="flex items-center">
                        <span>{STATUS_LABELS[status]}</span>
                        {isCurrent && <span className="loading loading-spinner loading-xs ml-2"></span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {processingComplete && (
            <div className="alert alert-success my-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="font-bold">Processing Complete!</h3>
                <div className="text-xs">Audio has been successfully processed.</div>
              </div>
            </div>
          )}

          <div className="flex justify-center mt-4">
            <button
              onClick={handleButtonClick}
              disabled={isLoading || isUploading || isProcessing}
              className={`btn btn-lg ${isRecording ? "btn-error" : "btn-primary"} ${isLoading && !isProcessing ? "loading" : ""}`}
            >
              {isLoading && !isProcessing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
            </button>
          </div>

          <div className="divider">OR</div>

          <div className="form-control">
            <label className="label">
              <span className="label-text">Upload Audio File</span>
            </label>
            <input
              type="file"
              className="file-input file-input-bordered w-full"
              accept="audio/*"
              onChange={handleFileUpload}
              disabled={isUploading || isRecording || isLoading || isProcessing}
              ref={fileInputRef}
            />
          </div>

          {error && (
            <div className="alert alert-error mt-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {visit?.final_soap_note && (
            <div className="mt-4">
              <div className="collapse collapse-arrow bg-base-200">
                <input type="checkbox" />
                <div className="collapse-title font-medium">View Generated SOAP Note</div>
                <div className="collapse-content">
                  <pre className="whitespace-pre-wrap text-sm">{visit.final_soap_note}</pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AudioRecorder;
