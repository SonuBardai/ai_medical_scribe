from .models import Visit
from threading import Thread
from .models import Polling
from django.db import transaction
import logging
from .helpers import get_transcript_from_deepgram, preprocess_transcript

logger = logging.getLogger(__name__)


def transcription_task(visit: Visit):
    # Initial transcription
    with transaction.atomic():
        audio_file_path = visit.audio_file.path
        transcript_data = get_transcript_from_deepgram(audio_file_path)
        visit.transcript_text = (
            transcript_data.get("results", {})
            .get("channels", [{}])[0]
            .get("alternatives", [{}])[0]
            .get("transcript", "")
        )
        transcript_json = preprocess_transcript(transcript_data)
        visit.transcript_json = transcript_json
        visit.save()

        Polling.objects.create(
            visit=visit,
            status="transcription_complete",
            completed=True,
            success=True,
        )

    return visit


def perform_rag(visit: Visit):
    # Detail extraction
    with transaction.atomic():
        # TODO: Implement actual detail extraction logic
        Polling.objects.create(
            visit=visit,
            status="details_extracted",
            completed=False,
            success=False,
        )

    return {}


def generate_soap(visit: Visit, raw_details: dict):
    with transaction.atomic():
        # TODO: Implement actual text generation logic

        Polling.objects.create(
            visit=visit,
            status="text_generated",
            completed=False,
            success=False,
        )


def process_transcription(visit: Visit):
    try:
        Polling.objects.create(visit=visit, status="audio_processing_started")

        transcription_task(visit)
        raw_details = perform_rag(visit)
        generate_soap(visit, raw_details)

        Polling.objects.create(
            visit=visit,
            status="completed",
            completed=True,
            success=True,
        )

    except Exception as e:
        Polling.objects.create(
            visit=visit,
            status="error",
            error=str(e),
            completed=True,
            success=False,
        )


def transcribe_audio(visit: Visit):
    thread = Thread(target=process_transcription, args=(visit,))
    thread.daemon = True
    thread.start()
