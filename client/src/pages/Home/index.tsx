import { useState, useEffect, useRef } from "react";
import { PROJECT_NAME, BACKEND_URL } from "Shared/constants";

const Home = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [visitId, setVisitId] = useState<string | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startRecording = async () => {
    setIsLoading(true);
    try {
      if (!visitId) {
        // Create visit first
        const response = await fetch(`${BACKEND_URL}/rest/visits`, {
          method: "POST",
        });
        const data = await response.json();
        setVisitId(data.visit_id);
      }

      // Start recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          setAudioChunks((prev) => [...prev, event.data]);
        }
      };

      recorder.onstop = async () => {
        if (audioChunks.length > 0) {
          const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");

          await fetch(`${BACKEND_URL}/rest/visits/${visitId}/audio`, {
            method: "POST",
            body: formData,
          });
        }
        setAudioChunks([]);
      };

      setMediaRecorder(recorder);
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      setMediaRecorder(null);
      setIsRecording(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      let id = visitId;
      if (!id) {
        // Create visit first
        const response = await fetch(`${BACKEND_URL}/rest/visits`, {
          method: "POST",
        });
        const data = await response.json();
        id = data.visit_id;
        setVisitId(id);
      }

      // Read the file as an array buffer
      const arrayBuffer = await file.arrayBuffer();

      // Create audio context and decode the audio
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Create a MediaStream from the audio buffer
      const stream = audioContext.createMediaStreamDestination();
      audioBuffer.getChannelData(0).forEach((sample, i) => {
        stream.connect(audioContext.destination);
      });

      // Create MediaRecorder with WebM Opus codec
      const recorder = new MediaRecorder(stream.stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      // Handle recorded chunks
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      // Start recording and immediately stop to get the compressed data
      recorder.start();
      recorder.stop();

      // Wait for recording to complete
      await new Promise<void>((resolve) => {
        recorder.onstop = () => {
          resolve();
        };
      });

      // Create the compressed blob
      const compressedBlob = new Blob(chunks, { type: "audio/webm" });

      // Upload the compressed file
      const formData = new FormData();
      formData.append("audio", compressedBlob, "compressed_recording.webm");

      await fetch(`${BACKEND_URL}/rest/visits/${id}/audio`, {
        method: "POST",
        body: formData,
      });

      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error("Error uploading file:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (mediaRecorder) {
        mediaRecorder.stop();
      }
    };
  }, [mediaRecorder]);

  return (
    <div className="min-h-screen bg-base-200 p-8">
      <div className="max-w-xl mx-auto text-center">
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center items-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
          ) : (
            <>
              <button className={`btn btn-lg ${isRecording ? "btn-error" : "btn-primary"}`} onClick={isRecording ? stopRecording : startRecording} disabled={isLoading}>
                {isRecording ? "Stop Recording" : "Record"}
              </button>

              <div className="mt-4">
                <label htmlFor="audioFile" className="btn btn-lg btn-outline border-dashed">
                  Upload Audio
                </label>
                <input type="file" id="audioFile" ref={fileInputRef} accept="audio/*" onChange={handleFileUpload} className="hidden" />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Home;
