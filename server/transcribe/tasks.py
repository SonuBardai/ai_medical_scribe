from .models import Visit
from threading import Thread
from .models import Polling
from django.db import transaction
import logging
from .helpers import get_transcript_from_deepgram, preprocess_transcript
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import OllamaEmbeddings
from langchain.prompts import ChatPromptTemplate
from langchain_ollama.llms import OllamaLLM
# from langchain_google_genai import ChatGoogleGenerativeAI

embeddings = OllamaEmbeddings(model="all-minilm")
llm = OllamaLLM(model="llama3")

# llm = ChatGoogleGenerativeAI(
#     model="gemini-2.0-flash",
#     temperature=0.2,  # Low temperature for factual accuracy
# )

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


def create_embeddings(visit: Visit):
    transcript_json = visit.transcript_json
    sentences = transcript_json["sentences"]
    speaker_mapping = transcript_json.get("speaker_mapping") or {}

    texts = []
    metadata = []
    for sentence in sentences:
        sentence_id = sentence["sentence_id"]
        speaker_id = sentence.get("speaker") or "unknown"
        speaker = (
            speaker_mapping.get(speaker_id)
            or speaker_mapping.get(str(speaker_id))
            or f"Speaker {speaker_id}"
        )
        texts.append(speaker + ": " + sentence["sentence"])
        metadata.append({"sentence_id": sentence_id, "speaker": speaker})

    vectorstore = Chroma.from_texts(
        texts=texts,
        embedding=embeddings,
        metadatas=metadata,
        persist_directory="./chromadb_transcripts",
    )
    vectorstore.persist()
    return vectorstore


def retrieve_relevant_sentences(query, vectorstore, top_k=5):
    docs = vectorstore.similarity_search(query, k=top_k)
    return [
        {
            "sentence_id": doc.metadata["sentence_id"],
            "sentence_text": doc.page_content,
            "speaker": doc.metadata["speaker"],
        }
        for doc in docs
    ]


def perform_rag(visit: Visit):
    # Detail extraction
    with transaction.atomic():
        vectorstore = create_embeddings(visit)

        # S
        query_subjective = "patient symptoms or health concerns or pain or discomfort"
        subjective_sentences = retrieve_relevant_sentences(
            query_subjective, vectorstore
        )

        # O
        query_objective = "objective findings"
        objective_sentences = retrieve_relevant_sentences(query_objective, vectorstore)

        # A
        query_assessment = "assessment or diagnosis"
        assessment_sentences = retrieve_relevant_sentences(
            query_assessment, vectorstore
        )

        # P
        query_plan = "treatment plan or recommendations"
        plan_sentences = retrieve_relevant_sentences(query_plan, vectorstore)

        Polling.objects.create(
            visit=visit,
            status="details_extracted",
            completed=True,
            success=True,
        )

        return {
            "subjective": subjective_sentences,
            "objective": objective_sentences,
            "assessment": assessment_sentences,
            "plan": plan_sentences,
        }


def generate_section(section_name, sentences):
    excerpts = "\n".join(
        f"{s['speaker'].capitalize()}: {s['sentence_text']}" for s in sentences
    )

    prompt_template = ChatPromptTemplate.from_template(f"""
    You are an assistant skilled in medical documentation. Based on the following excerpts from a doctor-patient conversation, generate the "{section_name}" section of a clinical SOAP note.

    Excerpts:
    {excerpts}

    {section_name}:

    Instructions:
    Do not add any information that is not mentioned by the patient or doctor in the transcript. If information is missing, respond with "N/A". Always respond with only the main content of the section, use the following format for your response:
    {section_name}:<your_response>
    """)

    chain = prompt_template | llm
    response = chain.invoke({})
    return response


def generate_soap(visit: Visit, raw_details: dict):
    with transaction.atomic():
        subjective_raw = raw_details.get("subjective", [])
        subjective_draft = generate_section("Subjective", subjective_raw)

        objective_raw = raw_details.get("objective", [])
        objective_draft = generate_section("Objective", objective_raw)

        assessment_raw = raw_details.get("assessment", [])
        assessment_draft = generate_section("Assessment", assessment_raw)

        plan_raw = raw_details.get("plan", [])
        plan_draft = generate_section("Plan", plan_raw)

        soap_draft = {
            "subjective": subjective_draft,
            "objective": objective_draft,
            "assessment": assessment_draft,
            "plan": plan_draft,
        }

        visit.draft_soap_note = soap_draft
        visit.save()

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


def process_regenerate(visit: Visit):
    try:
        Polling.objects.create(visit=visit, status="regenerate_soap_started")

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


def regenerate_soap(visit: Visit):
    thread = Thread(target=process_regenerate, args=(visit,))
    thread.daemon = True
    thread.start()
