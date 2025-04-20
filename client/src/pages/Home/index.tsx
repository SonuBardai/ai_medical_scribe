import { useState, useEffect, useRef } from "react";
import { BACKEND_URL } from "Shared/constants";
import axios from "axios";

// DUMMY STEPS
const PROCESSING_STEPS = [
  { id: "upload", label: "Uploading audio...", time: 2000 },
  { id: "transcribe", label: "Transcribing the audio...", time: 3000 },
  { id: "extract", label: "Extracting relevant details...", time: 2500 },
  { id: "generate", label: "Generating SOAP...", time: 3500 },
  { id: "finalize", label: "Adding final details...", time: 1500 },
];

const Home = () => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(-1);
  const [processingComplete, setProcessingComplete] = useState<boolean>(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<number | null>(null);
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

      // First get a visit ID from the backend
      const response = await axios.post(`${BACKEND_URL}/rest/visits`);
      const newVisitId = response.data.visit_id;
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

      // Start processing workflow
      await processAudio(audioBlob, visitId);

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

  const processAudio = async (audioBlob: Blob, visitId: string) => {
    setIsProcessing(true);
    setCurrentStep(0); // Start with upload step

    // Create FormData to send the audio file
    const formData = new FormData();
    formData.append("audio", audioBlob, `recording-${visitId}.${getFileExtension(audioBlob.type)}`);

    // Simulate upload + processing with step-by-step workflow
    for (let i = 0; i < PROCESSING_STEPS.length; i++) {
      setCurrentStep(i);

      // For the first step (upload), actually make the API call
      if (i === 0) {
        await axios.post(`${BACKEND_URL}/rest/visits/${visitId}/audio`, formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });
      }

      // For other steps, just wait the simulated time
      // In production, this would be replaced with polling for status
      await new Promise((resolve) => setTimeout(resolve, PROCESSING_STEPS[i].time));
    }

    // Processing complete
    setProcessingComplete(true);
    setIsProcessing(false);
    setIsLoading(false);
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

      // First get a visit ID from the backend if we don't have one
      let currentVisitId = visitId;
      if (!currentVisitId) {
        const response = await axios.post(`${BACKEND_URL}/rest/visits`);
        currentVisitId = response.data.visit_id;
        setVisitId(currentVisitId);
      }

      // Process the uploaded file
      await processAudio(file, currentVisitId!);

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

  // Clean up function to stop recording if component unmounts while recording
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) {
        const tracks = mediaRecorderRef.current.stream.getTracks();
        tracks.forEach((track) => track.stop());
      }

      if (timerIntervalRef.current !== null) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

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
          {isProcessing && (
            <div className="my-4">
              <ul className="steps steps-vertical w-full">
                {PROCESSING_STEPS.map((step, index) => (
                  <li key={step.id} className={`step ${index <= currentStep ? "step-primary" : ""}`} data-content={index < currentStep ? "✓" : index === currentStep ? "●" : "○"}>
                    <div className="flex items-center">
                      <span>{step.label}</span>
                      {index === currentStep && <span className="loading loading-spinner loading-xs ml-2"></span>}
                    </div>
                  </li>
                ))}
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
        </div>
      </div>
    </div>
  );
};

export default Home;
