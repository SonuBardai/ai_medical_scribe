import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import { BACKEND_URL } from "Shared/constants";
import { FaSpinner, FaExclamation, FaClock, FaMicrophone, FaMicrophoneSlash, FaUpload, FaInfoCircle } from "react-icons/fa";

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
    sentence_id: number;
    sentence: string;
    start: number;
    end: number;
    speaker: number;
    speaker_name: string;
  }[];
}

interface SoapItem {
  text: string;
  references: { sentence_id: number; start: number; end: number }[];
}

interface Visit {
  id: number;
  audio_file: string | null;
  transcript_text: string | null;
  transcript_json: Transcript | null;
  draft_soap_note: { subjective: SoapItem; objective: SoapItem; assessment: SoapItem; plan: SoapItem } | null;
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

  const [openSection, setOpenSection] = useState<string | null>(null);

  const [editedSoap, setEditedSoap] = useState<{
    subjective?: string | null;
    objective?: string | null;
    assessment?: string | null;
    plan?: string | null;
  } | null>(null);

  const [showSaveButton, setShowSaveButton] = useState(false);

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

  const formatRecordingTime = (timestamp: number) => {
    const minutes = Math.floor(timestamp / 60);
    const seconds = Math.floor(timestamp % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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

  const handleSaveSOAP = async () => {
    try {
      setIsProcessing(true);

      const finalSoap = {
        subjective: editedSoap?.subjective,
        objective: editedSoap?.objective,
        assessment: editedSoap?.assessment,
        plan: editedSoap?.plan,
      };
      await axios.post(`${BACKEND_URL}/rest/visits/${visit?.id}/soap_feedback`, finalSoap);

      setVisit((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          final_soap_note: finalSoap as {
            subjective: string;
            objective: string;
            assessment: string;
            plan: string;
          },
        };
      });

      // Reset the edited state
      setEditedSoap(null);
      setShowSaveButton(false);
    } catch (err) {
      setError(`Failed to save SOAP note: ${err instanceof Error ? err.message : String(err)}`);
      console.error("Error saving SOAP note:", err);
    } finally {
      setIsProcessing(false);
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

  const getReferencedSentences = (references: { sentence_id: number; start: number; end: number }[]) => {
    if (!visit?.transcript_json?.sentences) return [];

    const referencedSentences = visit.transcript_json.sentences.filter((s) => references.some((ref) => ref.sentence_id === s.sentence_id));

    // Create a map to track unique sentences with their timestamps
    const uniqueSentences = new Map<number, (typeof referencedSentences)[0] & { start: number; end: number }>();

    referencedSentences.forEach((sentence) => {
      const matchingRef = references.find((ref) => ref.sentence_id === sentence.sentence_id);
      if (matchingRef) {
        uniqueSentences.set(sentence.sentence_id, {
          ...sentence,
          start: matchingRef.start,
          end: matchingRef.end,
        });
      }
    });

    return Array.from(uniqueSentences.values());
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
                                      {formatRecordingTime(sentence.start)} - {formatRecordingTime(sentence.end)}
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
                      <div className="flex justify-end gap-2">
                        {showSaveButton && (
                          <button onClick={handleSaveSOAP} className="btn btn-success btn-sm" disabled={isProcessing}>
                            {isProcessing ? "Saving..." : "Save Changes"}
                          </button>
                        )}
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
                            <div className="flex justify-between items-center">
                              <h3 className="font-semibold text-base-content">Subjective</h3>
                              <button
                                onClick={() => setOpenSection(openSection === "subjective" ? null : "subjective")}
                                className="tooltip tooltip-bottom"
                                data-tip={openSection === "subjective" ? "Hide references" : "Show references"}
                              >
                                <FaInfoCircle className="h-5 w-5" />
                              </button>
                            </div>
                            <div className="form-control w-full">
                              <textarea
                                className="textarea textarea-bordered h-24"
                                value={editedSoap?.subjective || visit?.final_soap_note?.subjective || visit?.draft_soap_note?.subjective.text}
                                onChange={(e) => {
                                  setEditedSoap((prev) => ({
                                    ...prev,
                                    subjective: e.target.value,
                                  }));
                                  setShowSaveButton(true);
                                }}
                              />
                            </div>
                            {openSection === "subjective" && (
                              <div className="mt-2 space-y-2">
                                <h4 className="text-sm font-medium">Referenced Sentences:</h4>
                                <div className="space-y-1">
                                  {getReferencedSentences(visit.draft_soap_note.subjective.references).map((sentence) => (
                                    <div key={sentence.sentence_id} className="text-sm p-2 bg-base-200 rounded">
                                      <div className="flex justify-between items-center">
                                        <span className="font-medium">{sentence.speaker_name}: </span>
                                        <span className="text-xs text-gray-500">
                                          {formatRecordingTime(sentence.start)} - {formatRecordingTime(sentence.end)}
                                        </span>
                                      </div>
                                      <p className="mt-1">{sentence.sentence}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Objective */}
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <h3 className="font-semibold text-base-content">Objective</h3>
                              <button
                                onClick={() => setOpenSection(openSection === "objective" ? null : "objective")}
                                className="tooltip tooltip-bottom"
                                data-tip={openSection === "objective" ? "Hide references" : "Show references"}
                              >
                                <FaInfoCircle className="h-5 w-5" />
                              </button>
                            </div>
                            <div className="form-control w-full">
                              <textarea
                                className="textarea textarea-bordered h-24"
                                value={editedSoap?.objective || visit?.final_soap_note?.objective || visit?.draft_soap_note?.objective?.text}
                                onChange={(e) => {
                                  setEditedSoap((prev) => ({
                                    ...prev,
                                    objective: e.target.value,
                                  }));
                                  setShowSaveButton(true);
                                }}
                              />
                            </div>
                            {openSection === "objective" && (
                              <div className="mt-2 space-y-2">
                                <h4 className="text-sm font-medium">Referenced Sentences:</h4>
                                <div className="space-y-1">
                                  {getReferencedSentences(visit.draft_soap_note.objective.references).map((sentence) => (
                                    <div key={sentence.sentence_id} className="text-sm p-2 bg-base-200 rounded">
                                      <div className="flex justify-between items-center">
                                        <span className="font-medium">{sentence.speaker_name}: </span>
                                        <span className="text-xs text-gray-500">
                                          {formatRecordingTime(sentence.start)} - {formatRecordingTime(sentence.end)}
                                        </span>
                                      </div>
                                      <p className="mt-1">{sentence.sentence}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Assessment */}
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <h3 className="font-semibold text-base-content">Assessment</h3>
                              <button
                                onClick={() => setOpenSection(openSection === "assessment" ? null : "assessment")}
                                className="tooltip tooltip-bottom"
                                data-tip={openSection === "assessment" ? "Hide references" : "Show references"}
                              >
                                <FaInfoCircle className="h-5 w-5" />
                              </button>
                            </div>
                            <div className="form-control w-full">
                              <textarea
                                className="textarea textarea-bordered h-24"
                                value={editedSoap?.assessment || visit.final_soap_note?.assessment || visit.draft_soap_note.assessment.text}
                                onChange={(e) => {
                                  setEditedSoap((prev) => ({
                                    ...prev,
                                    assessment: e.target.value,
                                  }));
                                  setShowSaveButton(true);
                                }}
                              />
                            </div>
                            {openSection === "assessment" && (
                              <div className="mt-2 space-y-2">
                                <h4 className="text-sm font-medium">Referenced Sentences:</h4>
                                <div className="space-y-1">
                                  {getReferencedSentences(visit.draft_soap_note.assessment.references).map((sentence) => (
                                    <div key={sentence.sentence_id} className="text-sm p-2 bg-base-200 rounded">
                                      <div className="flex justify-between items-center">
                                        <span className="font-medium">{sentence.speaker_name}: </span>
                                        <span className="text-xs text-gray-500">
                                          {formatRecordingTime(sentence.start)} - {formatRecordingTime(sentence.end)}
                                        </span>
                                      </div>
                                      <p className="mt-1">{sentence.sentence}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Plan */}
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <h3 className="font-semibold text-base-content">Plan</h3>
                              <button
                                onClick={() => setOpenSection(openSection === "plan" ? null : "plan")}
                                className="tooltip tooltip-bottom"
                                data-tip={openSection === "plan" ? "Hide references" : "Show references"}
                              >
                                <FaInfoCircle className="h-5 w-5" />
                              </button>
                            </div>
                            <div className="form-control w-full">
                              <textarea
                                className="textarea textarea-bordered h-24"
                                value={editedSoap?.plan || visit.final_soap_note?.plan || visit.draft_soap_note.plan.text}
                                onChange={(e) => {
                                  setEditedSoap((prev) => ({
                                    ...prev,
                                    plan: e.target.value,
                                  }));
                                  setShowSaveButton(true);
                                }}
                              />
                            </div>
                            {openSection === "plan" && (
                              <div className="mt-2 space-y-2">
                                <h4 className="text-sm font-medium">Referenced Sentences:</h4>
                                <div className="space-y-1">
                                  {getReferencedSentences(visit.draft_soap_note.plan.references).map((sentence) => (
                                    <div key={sentence.sentence_id} className="text-sm p-2 bg-base-200 rounded">
                                      <div className="flex justify-between items-center">
                                        <span className="font-medium">{sentence.speaker_name}: </span>
                                        <span className="text-xs text-gray-500">
                                          {formatRecordingTime(sentence.start)} - {formatRecordingTime(sentence.end)}
                                        </span>
                                      </div>
                                      <p className="mt-1">{sentence.sentence}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
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
