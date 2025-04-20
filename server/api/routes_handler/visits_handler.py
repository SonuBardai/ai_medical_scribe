from ninja import Router
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import UploadedFile
from visits.models import Visit
from django.http import JsonResponse
import os
from threading import Thread
from django.db import transaction
from transcribe.models import Polling

router = Router()


def store_audio_file(file: UploadedFile, visit_id: int) -> str:
    filename = f"visit_{visit_id}_{file.name}"
    file_path = os.path.join("audio", filename)

    with default_storage.open(file_path, "wb") as destination:
        for chunk in file.chunks():
            destination.write(chunk)

    return file_path


def transcribe_audio(visit: Visit):
    def process_transcription():
        try:
            Polling.objects.create(visit=visit, status="audio_processing_started")

            # Initial transcription
            with transaction.atomic():
                # visit.transcript_text = ...
                # visit.transcript_json = ...
                # visit.save()

                Polling.objects.create(
                    visit=visit,
                    status="transcription_complete",
                    completed=False,
                    success=False,
                )

            # Detail extraction
            with transaction.atomic():
                # Simulate detail extraction
                # TODO: Implement actual detail extraction logic
                Polling.objects.create(
                    visit=visit,
                    status="details_extracted",
                    completed=False,
                    success=False,
                )

            # Text generation
            with transaction.atomic():
                # visit.draft_soap_note = ...
                # visit.save()

                Polling.objects.create(
                    visit=visit, status="text_generated", completed=False, success=False
                )

            Polling.objects.create(
                visit=visit, status="completed", completed=True, success=True
            )

        except Exception as e:
            Polling.objects.create(
                visit=visit,
                status="error",
                error=str(e),
                completed=True,
                success=False,
            )

    thread = Thread(target=process_transcription)
    thread.daemon = True
    thread.start()


@router.post("/visits", tags=["Visits"])
def create_visit(request):
    visit = Visit.objects.create()
    return JsonResponse({"id": visit.id})


@router.post("/visits/{visit_id}/audio", tags=["Visits"])
def upload_audio(request, visit_id: int):
    try:
        visit = Visit.objects.get(id=visit_id)
        audio_file = request.FILES.get("audio")
        if audio_file:
            # Store the file
            file_path = store_audio_file(audio_file, visit_id)
            visit.audio_file = file_path
            visit.save()

            # Start processs for transcribing
            transcribe_audio(visit)

            return JsonResponse(
                {"status": "success", "file_path": file_path, "visit_id": visit_id}
            )
        return JsonResponse({"error": "No audio file provided"}, status=400)
    except Visit.DoesNotExist:
        return JsonResponse({"error": "Visit not found"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@router.get("/visits/{visit_id}", tags=["Visits"])
def get_visit_details(request, visit_id: int):
    try:
        visit = Visit.objects.get(id=visit_id)
        polling_items = list(
            visit.pollings.values(
                "id",
                "status",
                "completed",
                "error",
                "success",
                "created_at",
                "updated_at",
            ).order_by("created_at")
        )

        return JsonResponse(
            {
                "visit": {
                    "id": visit.id,
                    "audio_file": visit.audio_file.url if visit.audio_file else None,
                    "transcript_text": visit.transcript_text,
                    "transcript_json": visit.transcript_json,
                    "draft_soap_note": visit.draft_soap_note,
                    "final_soap_note": visit.final_soap_note,
                    "created_at": visit.created_at.isoformat(),
                    "updated_at": visit.updated_at.isoformat(),
                },
                "pollings": polling_items,
            }
        )
    except Visit.DoesNotExist:
        return JsonResponse({"error": "Visit not found"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
