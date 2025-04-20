import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { BACKEND_URL } from "Shared/constants";
import { FaSpinner, FaExclamation, FaClock, FaMicrophone, FaMicrophoneSlash, FaUpload } from "react-icons/fa";

// Map status codes to user-friendly labels
const STATUS_LABELS: Record<string, string> = {
  audio_processing_started: "Transcribing audio...",
  transcription_complete: "Extracting details...",
  details_extracted: "Generating SOAP...",
  text_generated: "Finalizing SOAP...",
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

interface Transcript {
  sentences: {
    sentence: string;
    start: number;
    end: number;
    speaker: number;
    speaker_name: string;
  }[];
}

interface Visit {
  id: number;
  audio_file: string | null;
  transcript_text: string | null;
  transcript_json: Transcript | null;
  draft_soap_note: { subjective: string; objective: string; assessment: string; plan: string } | null;
  final_soap_note: { subjective: string; objective: string; assessment: string; plan: string } | null;
  created_at: string;
  updated_at: string;
  speaker_mapping: Record<number, string>;
}

interface PollingResponse {
  visit: Visit;
  pollings: PollingItem[];
}

const SPEAKER_COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-purple-100 text-purple-800",
  "bg-yellow-100 text-yellow-800",
  "bg-pink-100 text-pink-800",
  "bg-teal-100 text-teal-800",
];

const SPEAKER_OPTIONS = [
  { value: "Doctor", label: "Doctor" },
  { value: "Patient", label: "Patient" },
  { value: "Nurse", label: "Nurse" },
  { value: "Family Member", label: "Family Member" },
];

const getSpeakerColor = (speakerNumber: number): string => {
  return SPEAKER_COLORS[speakerNumber % SPEAKER_COLORS.length];
};

const AudioRecorder: React.FC = () => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [visitId, setVisitId] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [showRecordingUI, setShowRecordingUI] = useState<boolean>(true);

  // Processing state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [pollingItems, setPollingItems] = useState<PollingItem[]>([]);
  const [processingComplete, setProcessingComplete] = useState<boolean>(false);
  const [processingError, setProcessingError] = useState<boolean>(false);
  const [visit, setVisit] = useState<Visit | null>(null);

  const [editingSpeaker, setEditingSpeaker] = useState<number | null>(null);
  const [speakerMapping, setSpeakerMapping] = useState<{ [key: number]: string }>({});

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

      // Hide recording UI and show split view
      setShowRecordingUI(false);
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

      // Hide recording UI and show split view
      setShowRecordingUI(false);
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
        const visitData: PollingResponse = response.data;
        setVisit(visitData.visit);
        setSpeakerMapping(visitData.visit?.speaker_mapping || {});

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

  const updateSpeakerName = async (speaker: number, name: string) => {
    try {
      const response = await axios.post(`${BACKEND_URL}/rest/update_speaker`, {
        speaker,
        speaker_name: name,
        visit_id: visit?.id,
      });
      if (response.data.success) {
        // Update local state
        setSpeakerMapping((prev) => ({
          ...prev,
          [speaker]: name,
        }));
      }
    } catch (error) {
      console.error("Error updating speaker:", error);
    }
  };

  const getSpeakerName = (speaker: number) => {
    return speakerMapping[speaker] || `Speaker ${speaker}`;
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

      // Hide recording UI and show split view
      setShowRecordingUI(false);
    } catch (err) {
      setIsUploading(false);
      setIsProcessing(false);
      setError(`Failed to upload file: ${err instanceof Error ? err.message : String(err)}`);
      console.error("Error uploading file:", err);
    }
  };

  // Function to regenerate SOAP note
  const regenerateSOAP = async () => {
    try {
      setIsProcessing(true);
      setError("");

      const response = await fetch(`${BACKEND_URL}/rest/visits/${visit?.id}/regenerate_soap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to regenerate SOAP note");
      }

      startPolling(visitId!);
    } catch (err) {
      setIsProcessing(false);
      setError(`Failed to regenerate SOAP note: ${err instanceof Error ? err.message : String(err)}`);
      console.error("Error regenerating SOAP note:", err);
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
    <div className="flex flex-col h-screen">
      {/* Top navigation bar */}
      {!showRecordingUI && (
        <div className="bg-base-200 p-4 shadow-md">
          <div className="container mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">{visitId && <div className="badge badge-primary">Visit ID: {visitId}</div>}</div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`btn btn-sm ${isRecording ? "btn-error" : "btn-outline"}`}
                  disabled={isLoading || isUploading}
                >
                  <FaMicrophoneSlash className={`mr-1 ${isRecording ? "" : "hidden"}`} />
                  <FaMicrophone className={`mr-1 ${isRecording ? "hidden" : ""}`} />
                  {isRecording ? "Stop Recording" : "New Recording"}
                </button>
                <label className="btn btn-sm btn-outline" htmlFor="fileInput">
                  <FaUpload className="mr-1" />
                  Upload File
                </label>
                <input
                  type="file"
                  id="fileInput"
                  className="hidden"
                  accept="audio/*"
                  onChange={handleFileUpload}
                  disabled={isLoading || isUploading || isRecording}
                  ref={fileInputRef}
                />
              </div>
              {isRecording && (
                <div className="flex items-center gap-4">
                  <div className="badge badge-primary text-lg py-3 px-4">{formatTime(recordingTime)}</div>
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
              )}
            </div>
          </div>
        </div>
      )}
      {/* Main content */}
      <div className="flex-grow flex flex-col">
        {showRecordingUI ? (
          <div className="flex items-center justify-center flex-grow p-4">
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

                <div className="flex justify-center mt-4">
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    className={`btn btn-lg ${isRecording ? "btn-error" : "btn-primary"} ${isLoading ? "loading" : ""}`}
                    disabled={isLoading || isUploading}
                  >
                    {isLoading ? (
                      <>
                        <FaSpinner className="animate-spin mr-2" />
                        Processing...
                      </>
                    ) : isRecording ? (
                      <>
                        <FaMicrophoneSlash className="mr-2" />
                        Stop Recording
                      </>
                    ) : (
                      <>
                        <FaMicrophone className="mr-2" />
                        Start Recording
                      </>
                    )}
                  </button>
                </div>

                <div className="divider">OR</div>

                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Upload Audio File</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <FaUpload className="text-primary" />
                    <input
                      type="file"
                      className="file-input file-input-bordered w-full"
                      accept="audio/*"
                      onChange={handleFileUpload}
                      disabled={isLoading || isUploading || isRecording}
                      ref={fileInputRef}
                    />
                  </div>
                </div>

                {error && (
                  <div className="alert alert-error mt-4">
                    <FaExclamation className="stroke-current shrink-0 h-6 w-6 mr-1" />
                    <span>{error}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          // Split view layout for transcript and SOAP note
          <div className="max-h-full">
            <div className="flex flex-col md:flex-row">
              {/* Left panel - Transcript */}
              <div className="w-full md:w-1/2 border-r border-base-300 flex flex-col h-full overflow-y-auto">
                <div className="bg-base-100 shadow-sm flex-grow flex flex-col">
                  <div className="p-4 flex flex-col h-full overflow-hidden">
                    <h2 className="text-lg font-bold">Transcript</h2>

                    {/* Scrollable transcript content */}
                    <div className="flex-grow !max-h-[75vh] border rounded-md p-4 overflow-y-scroll">
                      {isProcessing && !visit?.transcript_text && (
                        <div className="flex flex-col items-center justify-center h-full">
                          <div className="loading loading-spinner loading-lg"></div>
                          <p className="mt-2 text-sm opacity-70">Generating transcript...</p>
                        </div>
                      )}

                      {visit?.transcript_json?.sentences && visit?.transcript_json.sentences.length > 0 ? (
                        <div className="space-y-4">
                          {visit.transcript_json.sentences.map((sentence, index) => {
                            const colorClass = getSpeakerColor(sentence.speaker);
                            return (
                              <div key={index} className="relative">
                                <div className="p-4">
                                  <div className="flex items-center mb-1">
                                    <div className={`relative ${colorClass}`}>
                                      {editingSpeaker === sentence.speaker ? (
                                        <select
                                          value={speakerMapping[sentence.speaker] || ""}
                                          onChange={(e) => {
                                            updateSpeakerName(sentence.speaker, e.target.value);
                                            setEditingSpeaker(null);
                                          }}
                                          onBlur={() => setEditingSpeaker(null)}
                                          className="select bg-base-content select-sm select-bordered w-full max-w-xs"
                                        >
                                          <option value="">Select Speaker</option>
                                          {SPEAKER_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                              {option.label}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        <div className="flex items-center gap-2">
                                          <span className={`px-2 py-1 rounded-full ${colorClass} font-medium`}>{getSpeakerName(sentence.speaker)}</span>
                                          <button onClick={() => setEditingSpeaker(sentence.speaker)} className="btn btn-xs btn-ghost">
                                            Edit
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    <span className="text-sm text-gray-500 ml-2">
                                      <FaClock className="inline mr-1" />
                                      {new Date(sentence.start * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} -
                                      {new Date(sentence.end * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  </div>
                                  <div className="prose max-w-none">
                                    <p className="text-sm">{sentence.sentence}</p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : processingComplete && !visit?.transcript_text ? (
                        <div className="flex flex-col items-center justify-center h-full">
                          <div className="alert alert-warning">
                            <FaExclamation className="stroke-current shrink-0 h-6 w-6 mr-1" />
                            <span>No transcript available</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right panel - SOAP Note */}
              <div className="w-full md:w-1/2 p-4 flex flex-col h-full overflow-hidden">
                <div className="card bg-base-100 shadow-sm flex-grow flex flex-col">
                  <div className="card-body p-4 flex flex-col h-full overflow-hidden">
                    <h2 className="card-title flex items-center justify-between text-lg font-bold">
                      <div>SOAP Note</div>
                      {/* generate again button */}
                      <div className="flex justify-end mt-2">
                        <button onClick={regenerateSOAP} className="btn btn-primary btn-sm" disabled={isProcessing}>
                          {isProcessing ? "Generating..." : "Generate Again"}
                        </button>
                      </div>
                    </h2>

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
                                  {isCurrent && <FaSpinner className="animate-spin ml-2" />}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {/* Scrollable SOAP content */}
                    <div className="flex-grow overflow-y-auto mt-4 h-full">
                      {processingComplete && visit?.draft_soap_note ? (
                        <div className="space-y-4">
                          {/* Subjective */}
                          <div className="space-y-2">
                            <h3 className="font-semibold text-base-content">Subjective</h3>
                            <pre className="whitespace-pre-wrap text-sm bg-base-100 p-4 rounded-lg border border-base-200">{visit.draft_soap_note.subjective}</pre>
                          </div>

                          {/* Objective */}
                          <div className="space-y-2">
                            <h3 className="font-semibold text-base-content">Objective</h3>
                            <pre className="whitespace-pre-wrap text-sm bg-base-100 p-4 rounded-lg border border-base-200">{visit.draft_soap_note.objective}</pre>
                          </div>

                          {/* Assessment */}
                          <div className="space-y-2">
                            <h3 className="font-semibold text-base-content">Assessment</h3>
                            <pre className="whitespace-pre-wrap text-sm bg-base-100 p-4 rounded-lg border border-base-200">{visit.draft_soap_note.assessment}</pre>
                          </div>

                          {/* Plan */}
                          <div className="space-y-2">
                            <h3 className="font-semibold text-base-content">Plan</h3>
                            <pre className="whitespace-pre-wrap text-sm bg-base-100 p-4 rounded-lg border border-base-200">{visit.draft_soap_note.plan}</pre>
                          </div>
                        </div>
                      ) : processingComplete && !visit?.draft_soap_note ? (
                        <div className="flex flex-col items-center justify-center h-full">
                          <div className="alert alert-warning">
                            <FaExclamation className="stroke-current shrink-0 h-6 w-6 mr-1" />
                            <span>No SOAP note available</span>
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* Error display */}
                    {error && !showRecordingUI && (
                      <div className="alert alert-error mt-4">
                        <FaExclamation className="stroke-current shrink-0 h-6 w-6 mr-1" />
                        <span>{error}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioRecorder;
