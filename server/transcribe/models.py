from django.db import models
from django.utils import timezone
from visits.models import Visit

# Create your models here.


class Polling(models.Model):
    STATUS_CHOICES = [
        ("audio_processing_started", "Audio Processing Started"),
        ("transcription_complete", "Transcription Complete"),
        ("details_extracted", "Details Extracted"),
        ("text_generated", "Text Generated"),
        ("completed", "Completed"),
        ("error", "Error"),
    ]

    visit = models.ForeignKey(Visit, on_delete=models.CASCADE, related_name="pollings")
    status = models.CharField(max_length=50, choices=STATUS_CHOICES)
    completed = models.BooleanField(default=False)
    error = models.TextField(null=True, blank=True)
    success = models.BooleanField(null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Polling {self.id} - {self.status} for Visit {self.visit_id}"
