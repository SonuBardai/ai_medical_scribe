# Setup
- `./run.sh`

# Optimizations
- Record in a compressed format (audio/webm with Opus codec) to keep file size manageable
  - Took 60 sec for Deepgram to transcribe a 40 minute audio
- Async operations
  - Render transcript in the UI while text extraction is going on - Improves UI
  - Polling for status updates - Improves UI
- Use nova-2-medical for transcription for better performance with medical data
- 
