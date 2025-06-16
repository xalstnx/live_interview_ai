// static/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- 모달 관련 DOM 요소 추가 ---
    const apiKeyModalOverlay = document.getElementById('api-key-modal-overlay');
    const apiKeyModal = document.getElementById('api-key-modal');
    const apiKeyInput = document.getElementById('api-key-input');
    const apiKeyConfirmBtn = document.getElementById('api-key-confirm-btn');

    // 기존 DOM 요소
    const resumeDropZone = document.getElementById('resume-drop-zone');
    const resumeFileInput = document.getElementById('resume-file-input');
    const pdfViewer = document.getElementById('pdf-viewer');
    const analyzeBtn = document.getElementById('analyze-btn');
    const startLiveBtn = document.getElementById('start-live-btn');
    const endInterviewBtn = document.getElementById('end-interview-btn');
    const questionsContainer = document.getElementById('questions-container');
    const liveTranscript = document.getElementById('live-transcript');
    const liveStatus = document.getElementById('live-status');
    const scoreDisplay = document.getElementById('score-display');
    const cumulativeScoreSpan = document.getElementById('cumulative-score');
    const keypointInput = document.getElementById('keypoint-input');
    const addKeypointBtn = document.getElementById('add-keypoint-btn');
    const keypointsContainer = document.getElementById('keypoints-container');

    const BUTTON_COLORS = ['#f5222d', '#fa8c16', '#13c2c2', '#52c41a', '#722ed1', '#eb2f96'];

    // --- 상태 변수 수정 ---
    let geminiApiKey = null; // API 키 저장 변수 추가
    let resumeFile = null;
    let markdownResume = '';
    let keypoints = ['협업 능력', '문제 해결 능력'];
    
    let mediaRecorder = null;
    let currentAudioChunks = [];
    let audioQueue = [];
    let llmResponseHistory = [];
    let isRecording = false;
    let isAnalyzing = false;
    let totalAnalyzedCount = 0;
    let interviewEnded = false;

    // --- 모달 로직 추가 ---
    apiKeyInput.addEventListener('input', () => {
        // 입력 필드에 값이 있으면 확인 버튼 활성화
        apiKeyConfirmBtn.disabled = apiKeyInput.value.trim() === '';
    });

    apiKeyConfirmBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            geminiApiKey = key;
            // 모달 숨기기
            apiKeyModal.style.display = 'none';
            apiKeyModalOverlay.style.display = 'none';
        }
    });


    // Keypoint 렌더링
    function renderKeypoints() {
        keypointsContainer.innerHTML = '';
        keypoints.forEach((kp, index) => {
            const tag = document.createElement('span');
            tag.className = 'keypoint-tag';
            tag.textContent = kp;
            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'delete-keypoint';
            deleteBtn.innerHTML = '×';
            deleteBtn.onclick = () => {
                keypoints.splice(index, 1);
                renderKeypoints();
            };
            tag.appendChild(deleteBtn);
            keypointsContainer.appendChild(tag);
        });
    }
    addKeypointBtn.addEventListener('click', () => {
        const value = keypointInput.value.trim();
        if (value && !keypoints.includes(value)) {
            keypoints.push(value);
            keypointInput.value = '';
            renderKeypoints();
        }
    });
    keypointInput.addEventListener('keypress', (e) => e.key === 'Enter' && addKeypointBtn.click());
    renderKeypoints();

    // 파일 핸들링
    function handleFile(file) {
        if (!geminiApiKey) {
            alert('먼저 상단의 모달 창에서 API 키를 설정해주세요.');
            return;
        }
        if (file && file.type === 'application/pdf') {
            resumeFile = file;
            const fileURL = URL.createObjectURL(file);
            pdfViewer.src = fileURL;
            pdfViewer.style.display = 'block';
            resumeDropZone.style.display = 'none';
            analyzeBtn.disabled = false;
        } else {
            alert('PDF 파일만 업로드할 수 있습니다.');
        }
    }
    resumeDropZone.addEventListener('click', () => resumeFileInput.click());
    resumeFileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    resumeDropZone.addEventListener('dragover', (e) => e.preventDefault());
    resumeDropZone.addEventListener('drop', (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });

    // 이력서 분석 (API 키 전송 로직 추가)
    analyzeBtn.addEventListener('click', async () => {
        if (!resumeFile) return;
        if (!geminiApiKey) {
            alert('API 키가 설정되지 않았습니다. 페이지를 새로고침하여 키를 설정해주세요.');
            return;
        }
        
        startLiveBtn.disabled = true;

        audioQueue = [];
        llmResponseHistory = [];
        totalAnalyzedCount = 0;
        interviewEnded = false;
        isRecording = false;
        
        liveTranscript.innerHTML = '<p class="placeholder">녹음 시작 후 내용이 표시됩니다.</p>';
        updateStatus();
        scoreDisplay.style.display = 'none';
        cumulativeScoreSpan.textContent = 'N/A';
        startLiveBtn.textContent = '녹음 시작';
        startLiveBtn.style.backgroundColor = 'var(--primary-color)';
        endInterviewBtn.style.display = 'none';

        analyzeBtn.disabled = true;
        analyzeBtn.textContent = '분석 중...';
        questionsContainer.innerHTML = '<p class="placeholder">이력서를 분석하여 질문을 생성하고 있습니다...</p>';
        
        const formData = new FormData();
        formData.append('file', resumeFile);
        formData.append('keypoints', JSON.stringify(keypoints));
        formData.append('api_key', geminiApiKey); // API 키 추가
        
        try {
            const response = await fetch('/analyze-resume', { method: 'POST', body: formData });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `서버 오류: ${response.statusText}`);
            if (data.error) throw new Error(data.error);
            
            markdownResume = data.markdown_resume;
            const questionList = document.createElement('ul');
            data.questions.forEach(q => { const li = document.createElement('li'); li.textContent = q; questionList.appendChild(li); });
            questionsContainer.innerHTML = '';
            questionsContainer.appendChild(questionList);
            
            startLiveBtn.disabled = false;
        } catch (error) {
            console.error('Error analyzing resume:', error);
            questionsContainer.innerHTML = `<p class="placeholder" style="color:red;">분석 실패: ${error.message}</p>`;
        } finally {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = '이력서 인식 및 질문 추천';
        }
    });

    // 녹음 및 분석 요청 로직
    startLiveBtn.addEventListener('click', () => {
        if (interviewEnded) return;
        if (isRecording) {
            requestAnalysis();
        } else {
            startInterview();
        }
    });

    endInterviewBtn.addEventListener('click', () => {
        endInterview();
    });

    async function startInterview() {
        if (!markdownResume) {
            alert('먼저 이력서 인식을 실행해주세요.');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorder.ondataavailable = (event) => {
                if(event.data.size > 0) currentAudioChunks.push(event.data);
            };
            startRecording();
        } catch (error) {
            console.error('마이크 접근 오류:', error);
            updateStatus('오류: 마이크 접근 불가');
        }
    }
    
    function startRecording() {
        currentAudioChunks = [];
        mediaRecorder.start();
        isRecording = true;
        
        const randomColor = BUTTON_COLORS[Math.floor(Math.random() * BUTTON_COLORS.length)];
        startLiveBtn.style.backgroundColor = randomColor;

        startLiveBtn.disabled = false;
        startLiveBtn.textContent = '분석 요청';
        endInterviewBtn.style.display = 'inline-block';
        updateStatus();
    }

    function requestAnalysis() {
        if (!mediaRecorder || !isRecording) return;

        startLiveBtn.disabled = true;
        startLiveBtn.textContent = '처리 중...';
        startLiveBtn.style.backgroundColor = '#a0a0a0';
        
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(currentAudioChunks, { type: 'audio/webm' });
            if (audioBlob.size > 0) {
                audioQueue.push(audioBlob);
                processAudioQueue();
            }
            if (!interviewEnded) {
                startRecording(); 
            }
            mediaRecorder.onstop = null; 
        };

        mediaRecorder.stop();
        isRecording = false;
        updateStatus();
    }

    function endInterview() {
        if (!mediaRecorder || interviewEnded) return;
        interviewEnded = true;
        isRecording = false;

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(currentAudioChunks, { type: 'audio/webm' });
            if (audioBlob.size > 0) {
                audioQueue.push(audioBlob);
                processAudioQueue();
            }
            if (mediaRecorder.stream) {
                mediaRecorder.stream.getTracks().forEach(track => track.stop());
            }
            mediaRecorder.onstop = null;
        };

        if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        } else {
            if (mediaRecorder.onstop) {
                mediaRecorder.onstop();
            }
        }

        startLiveBtn.textContent = '녹음 시작';
        startLiveBtn.style.backgroundColor = 'var(--primary-color)';
        startLiveBtn.disabled = true; 
        endInterviewBtn.style.display = 'none';
        updateStatus('면접이 종료되었습니다.');
    }

    function updateStatus(overrideText = '') {
        if (overrideText) {
            liveStatus.textContent = `상태: ${overrideText}`;
            return;
        }

        const submittedCount = totalAnalyzedCount + audioQueue.length + (isAnalyzing ? 1 : 0);

        let statusText = '상태: ';
        if (interviewEnded) {
            statusText += '면접 종료됨';
            if (isAnalyzing || audioQueue.length > 0) statusText += ' (마지막 분석 중...)';
        } else if (isRecording) {
            statusText += `대화 ${submittedCount + 1} 녹음 중...`;
        } else if (isAnalyzing) {
            statusText += `${totalAnalyzedCount + 1}번째 대화 분석 중...`;
            if (audioQueue.length > 0) {
                statusText += ` (${audioQueue.length}개 대기 중)`;
            }
        } else if (audioQueue.length > 0) {
            statusText += `${totalAnalyzedCount + 1}번째 대화 분석 준비 중...`;
        } else {
            statusText += '대기 중';
        }
        liveStatus.textContent = statusText;
    }

    // 오디오 처리 (API 키 전송 로직 추가)
    async function processAudioQueue() {
        if (isAnalyzing || audioQueue.length === 0) {
            return;
        }

        isAnalyzing = true;
        const audioBlob = audioQueue.shift();
        updateStatus();

        const formData = new FormData();
        formData.append('audio_files', audioBlob, `interview_turn.webm`);
        formData.append('markdown_resume', markdownResume);
        formData.append('keypoints', JSON.stringify(keypoints));
        formData.append('interviewer_count', document.getElementById('interviewer-count').value);
        formData.append('interviewee_count', document.getElementById('interviewee-count').value);
        formData.append('llm_response_history', JSON.stringify(llmResponseHistory));
        formData.append('api_key', geminiApiKey); // API 키 추가

        try {
            const response = await fetch('/process-audio', {
                method: 'POST',
                body: formData
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `서버 오류: ${response.statusText}`);
            if (result.error) throw new Error(result.error);

            llmResponseHistory.push(result);
            totalAnalyzedCount++;

            if (totalAnalyzedCount === 1) {
                liveTranscript.innerHTML = '';
                scoreDisplay.style.display = 'block';
            }

            const resultDiv = document.createElement('div');
            resultDiv.className = 'analysis-result';
            resultDiv.innerHTML = `
                <h4>[대화 ${totalAnalyzedCount} 내용]</h4>
                <p>${result.transcript || '텍스트 변환 실패'}</p>
                <h4>[대화 ${totalAnalyzedCount} 분석 및 추천 질문]</h4>
                <p>${result.analysis || '분석 내용 없음'}</p>
                <ul>
                    ${(result.follow_up_questions || []).map(q => `<li>${q}</li>`).join('')}
                </ul>
                <hr>
            `;
            liveTranscript.appendChild(resultDiv);
            liveTranscript.scrollTop = liveTranscript.scrollHeight;

            cumulativeScoreSpan.textContent = `${result.cumulative_score} / 100`;

        } catch (error) {
            console.error('오디오 분석 요청 오류:', error);
            const errorDiv = document.createElement('div');
            errorDiv.className = 'analysis-result';
            errorDiv.style.color = 'red';
            errorDiv.innerHTML = `<h4>[대화 ${totalAnalyzedCount + 1} 분석 오류]</h4><p>${error.message}</p><hr>`;
            liveTranscript.appendChild(errorDiv);
        } finally {
            isAnalyzing = false;
            updateStatus();
            setTimeout(processAudioQueue, 0);
        }
    }
});