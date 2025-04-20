from ninja import Router
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import UploadedFile
from visits.models import Visit
from django.http import JsonResponse
import os
import logging
from transcribe.tasks import transcribe_audio, regenerate_soap
import json

logger = logging.getLogger(__name__)

router = Router()


def store_audio_file(file: UploadedFile, visit_id: int) -> str:
    # TODO: Write to some object store
    filename = f"visit_{visit_id}_{file.name}"
    file_path = os.path.join("audio", filename)

    with default_storage.open(file_path, "wb") as destination:
        for chunk in file.chunks():
            destination.write(chunk)

    return file_path


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


@router.post("/visits/{visit_id}/regenerate_soap", tags=["Visits"])
def request_regenerate_soap(request, visit_id: int):
    try:
        visit = Visit.objects.get(id=visit_id)
        visit.pollings.all().delete()
        regenerate_soap(visit)

    except Visit.DoesNotExist:
        return JsonResponse({"error": "Visit not found"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@router.post("/visits/{visit_id}/soap_feedback", tags=["Visits"])
def soap_feedback(request, visit_id: int):
    try:
        visit = Visit.objects.get(id=visit_id)
        data = json.loads(request.body)

        # Update the SOAP note fields
        visit.final_soap_note = {
            "subjective": data.get(
                "subjective",
                visit.draft_soap_note["subjective"] if visit.draft_soap_note else "",
            ),
            "objective": data.get(
                "objective",
                visit.draft_soap_note["objective"] if visit.draft_soap_note else "",
            ),
            "assessment": data.get(
                "assessment",
                visit.draft_soap_note["assessment"] if visit.draft_soap_note else "",
            ),
            "plan": data.get(
                "plan", visit.draft_soap_note["plan"] if visit.draft_soap_note else ""
            ),
        }

        visit.save()
        return JsonResponse({"status": "success"})

    except Visit.DoesNotExist:
        return JsonResponse({"error": "Visit not found"}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        logger.error(f"Error updating SOAP note: {str(e)}")
        return JsonResponse({"error": "Internal server error"}, status=500)
