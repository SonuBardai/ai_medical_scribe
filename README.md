# Setup
- `./run.sh`

# Optimizations
- Record in a compressed format (audio/webm with Opus codec) to keep file size manageable
  - Took 39 sec for Deepgram to transcribe a 40 minute audio
- Async operations
  - Render transcript in the UI while text extraction is going on - Improves UI
  - Polling for status updates - Improves UI
- Use nova-2-medical for transcription for better performance with medical data
- 


# Edgecases covered
1. How would you create a mapping between each line in the final SOAP note and the excerpts from the transcript from which it was inferred? (So that a physician could hover over that line and see where it came from, as they review the note for accuracy before they sign it)
2. Design a feedback loop that improves accuracy over time based on clinician edits
3. How would you handle medical conversations with multiple speakers (provider, patient, nurse, family member)?
   - 
4. How would your system manage poor audio quality or strong accents?

