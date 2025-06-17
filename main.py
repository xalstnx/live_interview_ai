import os
import json
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from google import genai
from google.genai import types
from typing import List, Optional

model = 'gemini-2.5-flash-preview-05-20'

app = FastAPI()

# --- 이력서 분석 (PDF -> Markdown 및 질문 생성) ---
@app.post("/analyze-resume")
async def analyze_resume(
    file: UploadFile = File(...),
    keypoints: str = File(...),
    api_key: str = Form(...)  # 클라이언트로부터 API 키 받기
):
    try:
        # 클라이언트로부터 받은 API 키로 Gemini 클라이언트 초기화
        client = genai.Client(api_key=api_key)

        pdf_content = await file.read()
        keypoints_list = json.loads(keypoints)
        joined_keypoints_list = ', '.join(keypoints_list)

        # 프롬프트 구성
        prompt = f"""
        당신은 전문 채용 담당자입니다. 아래 제공되는 이력서(PDF 파일)의 내용을 마크다운 형식으로 transcribe 해주세요.
        그 후, 정리된 이력서 내용과 다음 핵심 평가 요소들을 바탕으로 면접에서 할 만한 심층 질문 3개를 생성해주세요.

        # 핵심 평가 요소:
        {joined_keypoints_list}

        # 출력 형식:
        마크다운으로 변환된 이력서 내용과 추천 질문 3개를 명확히 구분하여 JSON 형식으로 응답해주세요.
        """

        generate_content_config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=genai.types.Schema(
                type = genai.types.Type.OBJECT,
                required = ["markdown_resume", "questions"],
                properties = {
                    "markdown_resume": genai.types.Schema(
                        type = genai.types.Type.STRING,
                        description = "마크다운으로 변환된 이력서 전체 내용"
                    ),
                    "questions": genai.types.Schema(
                        type = genai.types.Type.ARRAY,
                        description = "이력서와 keypoints 기반 추천 질문 3가지 리스트",
                        items = genai.types.Schema(
                            type = genai.types.Type.STRING,
                        ),
                        maxItems=3,
                        minItems=3
                    ),
                },
            ),
        )

        response = client.models.generate_content(
            model=model,
            contents=[
                types.Part.from_bytes(data=pdf_content, mime_type='application/pdf'), 
                prompt
            ],
            config=generate_content_config
        )

        print("---text response---")
        print(response)

        # Gemini 응답에서 JSON 부분만 추출
        response_text = response.text.strip()
        
        # 가끔 응답이 ```json ... ``` 으로 감싸져 오는 경우 처리
        if response_text.startswith("```json"):
            response_text = response_text[7:-3].strip()

        return json.loads(response_text)

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "이력서 분석에 실패했습니다. API 키가 유효한지 확인해주세요. " + str(e)})

# --- 오디오 파일 처리 및 면접 질문 생성 ---
@app.post("/process-audio")
async def process_audio(
    audio_files: List[UploadFile] = File(...),
    markdown_resume: str = Form(...),
    keypoints: str = Form(...),
    interviewer_count: int = Form(...),
    interviewee_count: int = Form(...),
    llm_response_history: Optional[str] = Form(None),
    api_key: str = Form(...) # 클라이언트로부터 API 키 받기
):
    try:
        # 클라이언트로부터 받은 API 키로 Gemini 클라이언트 초기화
        client = genai.Client(api_key=api_key)

        keypoints_list = json.loads(keypoints)
        joined_keypoints_list = ', '.join(keypoints_list)

        previous_llm_responses = []
        if llm_response_history:
            previous_llm_responses = json.loads(llm_response_history)

        prompt_parts = []
        prompt_parts.append(f"""
        당신은 면접관을 돕는 AI 어시스턴트입니다. 면접은 {interviewer_count}명의 면접관과 {interviewee_count}명의 면접자로 진행 중입니다.
        면접자의 이력서 내용과 핵심 평가 포인트는 아래와 같습니다.

        # 이력서 (Markdown):
        {markdown_resume}

        # 회사의 핵심 평가 포인트:
        {joined_keypoints_list}
        """)

        if previous_llm_responses:
            prompt_parts.append("\n# 이전 면접 대화 (LLM 분석 결과):\n")
            for i, prev_res in enumerate(previous_llm_responses):
                prompt_parts.append(f"## 답변 {i+1} 분석:")
                prompt_parts.append(f"**변환 텍스트**: {prev_res.get('transcript', '없음')}")
                prompt_parts.append(f"**분석 내용**: {prev_res.get('analysis', '없음')}")
                prompt_parts.append(f"**누적 점수**: {prev_res.get('cumulative_score', '없음')}")
                prompt_parts.append("\n")

        prompt_parts.append(f"""
        # 당신의 임무:
        이제 제공되는 **오디오 파일 (최신 대화)**을 듣고, 위에 제시된 이력서, 핵심 평가 포인트, 그리고 이전 대화 내용과 분석(텍스트)을 모두 종합적으로 고려하여 다음 과업을 수행해주세요.
        이 대화에는 면접관의 질문과 면접자의 답변이 모두 포함될 수 있습니다.

        1.  **음성 대화 변환**: 가장 마지막 음성 대화를 텍스트로 정확하게 변환합니다.(면접관과 면접자 모두의 음성 대화를 텍스트로 변환. 다수인 경우, 면접관1: ~~과 같이 넘버링과 함께 제공)
        2.  **상황 분석 및 역량 평가**: 전체 대화 맥락(면접관의 질문과 면접자의 답변 모두)과 회사의 keypoints를 고려하여 면접자의 역량을 심층적으로 분석합니다.
        3.  **누적 점수 산출**: 현재까지의 모든 대화 내용을 바탕으로 면접자의 역량을 **0점에서 100점 사이의 누적 점수**로 평가합니다. 0점은 매우 부정적, 100점은 매우 긍정적인 평가를 의미합니다.
        4.  **후속 질문 추천**: 분석을 바탕으로 면접관이 이어가면 좋을 만한 날카로운 후속 질문을 1~2개 추천해주세요. (만약 마지막 대화가 면접관의 질문이었다면, 추천 질문은 생략해도 좋습니다.)

        # 출력 형식 (JSON):
        결과는 반드시 주어진 JSON 형식으로만 응답해야 합니다. 다른 설명이나 코멘트는 절대 추가하지 마세요.
        """
        )
        prompt = "\n".join(prompt_parts)
        contents = [prompt]

        generate_content_config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=genai.types.Schema(
                type = genai.types.Type.OBJECT,
                required = ["transcript", "cumulative_score"],
                properties = {
                    "transcript": genai.types.Schema(
                        type = genai.types.Type.STRING,
                        description = "음성을 텍스트로 변환한 내용(면접관과 면접자 모두의 음성 대화를 텍스트로 변환. 다수인 경우, 면접관1: ~~과 같이 넘버링과 함께 변환. 다수가 아닌 경우, 면접관: ~~\n면접자: ~~ 형태로 변환)"
                    ),
                    "analysis": genai.types.Schema(
                        type = genai.types.Type.STRING,
                        description = "이력서와 keypoints, 최근 면접 대화에 대한 간단한 분석 내용(3줄 이하로 분석). 분석할만한 음성내용이 없을 경우, 생략 가능."
                    ),
                    "cumulative_score": genai.types.Schema(
                        type=genai.types.Type.INTEGER,
                        description="현재까지의 대화 내용을 종합하여 평가한 누적 점수 (0-100점). 분석할만한 음성내용이 없을 경우, 이전 점수 유지.",
                        minimum=0,
                        maximum=100
                    ),
                    "follow_up_questions": genai.types.Schema(
                        type = genai.types.Type.ARRAY,
                        description = "이력서와 keypoints, 최근 면접 대화 기반의 추천 질문 1~2가지 리스트. 마지막 대화가 면접관 질문이었다면 생략 가능.",
                        items = genai.types.Schema(
                            type = genai.types.Type.STRING,
                        ),
                        maxItems=2,
                        minItems=0
                    ),
                },
            ),
        )

        last_audio_file = audio_files[-1]
        audio_content = await last_audio_file.read()
        contents.append(types.Part.from_bytes(
            data=audio_content,
            mime_type=last_audio_file.content_type)
        )
        
        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=generate_content_config
        )
        
        print("---audio response---")
        print(response)

        response_text = response.text.strip()
        # 가끔 응답이 ```json ... ``` 으로 감싸져 오는 경우 처리
        if response_text.startswith("```json"):
            response_text = response_text[7:-3].strip()

        return JSONResponse(content=json.loads(response_text))

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": "오디오 분석에 실패했습니다. API 키가 유효한지 확인해주세요. " + str(e)})


# --- 정적 파일 및 루트 경로 설정 ---
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def read_root():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())