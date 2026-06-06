document.addEventListener('DOMContentLoaded', () => {

    // --- Elements: Inputs ---
    const dropZone = document.getElementById('dropZone');
    const imageUpload = document.getElementById('imageUpload');
    const uploadContent = document.querySelector('.upload-content');

    const generateBtn = document.getElementById('generateBtn');
    const userInput = document.getElementById('userInput');
    const charCount = document.getElementById('charCount');
    const formatSelect = document.getElementById('formatSelect');

    // --- Elements: Navigation ---
    const step1 = document.getElementById('step-1');
    const step2 = document.getElementById('step-2');
    const step3 = document.getElementById('step-3');
    const backToStep1Btn = document.getElementById('backToStep1Btn');
    const backToStep2Btn = document.getElementById('backToStep2Btn');
    const selectBtns = document.querySelectorAll('.select-btn');
    const documentPreview = document.getElementById('documentPreview');
    const downloadWordBtn = document.getElementById('downloadWordBtn');
    const downloadLatexBtn = document.getElementById('downloadLatexBtn');
    const newProjectBtn = document.getElementById('newProjectBtn');
    downloadWordBtn.disabled = true;
    downloadLatexBtn.disabled = true;

    // --- State & Cache ---
    let lastPayloadStr = null; // Used for Token Caching
    let generatedData = {}; // Stores raw text output from each API
    let selectedMarkdown = '';

    // --- Academic Text Renderer ---
    function renderAcademicText(text) {
        const lines = text.split('\n');
        let html = '';
        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) {
                html += '<br>';
                return;
            }
            // Main section: I. INTRODUCTION, II. METHODS etc.
            if (/^[IVXLC]+\.\s+[A-Z\uAC00-\uD7A3]/.test(trimmed)) {
                html += `<h2 class="academic-section">${trimmed}</h2>`;
            }
            // Subsection: A. Title or A.1 Title
            else if (/^[A-Z][\.\d]*\.\s+/.test(trimmed)) {
                html += `<h3 class="academic-subsection">${trimmed}</h3>`;
            }
            // Numbered subsection like 1.1, 2.3 etc
            else if (/^\d+\.\d+\s+/.test(trimmed)) {
                html += `<h3 class="academic-subsection">${trimmed}</h3>`;
            }
            // Top-level bold (abstract, keywords line)
            else if (/^(Abstract|Keywords|ABSTRACT|KEYWORDS)/i.test(trimmed)) {
                html += `<h2 class="academic-section">${trimmed}</h2>`;
            }
            else {
                html += `<p>${trimmed}</p>`;
            }
        });
        return html;
    }

    // --- Image Upload Logic ---
    const imagePreviewList = document.getElementById('imagePreviewList');
    const uploadInfo = document.getElementById('uploadInfo');
    const MAX_FILES = 10;
    const MAX_FILE_SIZE_MB = 5;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    const MAX_TEXT_LENGTH = 5000;
    let imageFiles = [];

    // --- Text input character counter ---
    userInput.addEventListener('input', () => {
        charCount.textContent = userInput.value.length;
    });

    dropZone.addEventListener('click', () => {
        imageUpload.click();
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--accent)';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--panel-border)';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--panel-border)';
        if (e.dataTransfer.files && e.dataTransfer.files.length) {
            handleFiles(Array.from(e.dataTransfer.files));
        }
    });

    imageUpload.addEventListener('change', function () {
        if (this.files && this.files.length) {
            handleFiles(Array.from(this.files));
        }
    });

    function handleFiles(files) {
        const selectedImages = files.filter(file => file.type.startsWith('image/'));
        if (!selectedImages.length) {
            alert('Only image files can be uploaded.');
            return;
        }

        if (imageFiles.length + selectedImages.length > MAX_FILES) {
            alert(`Maximum ${MAX_FILES} images can be uploaded.`);
            return;
        }

        const oversized = selectedImages.filter(file => file.size > MAX_FILE_SIZE_BYTES);
        if (oversized.length) {
            alert(`Maximum file size is ${MAX_FILE_SIZE_MB}MB.`);
            return;
        }

        const readPromises = selectedImages.map(file => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                const fullBase64 = e.target.result;
                resolve({
                    name: file.name,
                    size: file.size,
                    previewUrl: fullBase64,
                    base64: fullBase64.split(',')[1]
                });
            };
            reader.onerror = () => reject(new Error('Error reading file.'));
            reader.readAsDataURL(file);
        }));

        Promise.all(readPromises)
            .then(results => {
                imageFiles = imageFiles.concat(results);
                renderPreviews();
                imageUpload.value = '';
            })
            .catch(error => {
                console.error(error);
                alert('Error uploading image.');
            });
    }

    function renderPreviews() {
        imagePreviewList.innerHTML = '';
        if (!imageFiles.length) {
            uploadContent.style.display = 'flex';
            uploadInfo.textContent = `Maximum ${MAX_FILES} images, ${MAX_FILE_SIZE_MB}MB per file.`;
            return;
        }

        uploadContent.style.display = 'none';
        uploadInfo.textContent = `${imageFiles.length}/${MAX_FILES} uploaded · Maximum ${MAX_FILE_SIZE_MB}MB per file`;

        imageFiles.forEach((item, index) => {
            const thumb = document.createElement('div');
            thumb.className = 'preview-thumb';
            thumb.innerHTML = `
                <img src="${item.previewUrl}" alt="${item.name}">
                <div class="preview-meta">
                    <span>${item.name}</span>
                    <button type="button" class="preview-remove-btn" data-index="${index}" aria-label="Remove image">×</button>
                </div>
            `;
            imagePreviewList.appendChild(thumb);
        });

        imagePreviewList.querySelectorAll('.preview-remove-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const idx = Number(e.currentTarget.dataset.index);
                imageFiles.splice(idx, 1);
                renderPreviews();
            });
        });
    }

    function resetForm() {
        userInput.value = '';
        formatSelect.value = 'IEEE';
        imageFiles = [];
        imageUpload.value = '';
        renderPreviews();
        lastPayloadStr = null;
        generatedData = {};
        selectedMarkdown = '';
        documentPreview.innerHTML = '';

        document.querySelectorAll('.select-btn').forEach(btn => btn.disabled = true);
        downloadWordBtn.disabled = true;
        downloadLatexBtn.disabled = true;
        document.querySelectorAll('.markdown-content').forEach(div => {
            div.innerHTML = '';
            div.style.display = 'none';
        });
        document.querySelectorAll('.loading-spinner').forEach(spinner => spinner.style.display = 'none');
        document.querySelectorAll('.placeholder-text').forEach(text => text.style.display = 'block');
    }

    // --- Navigation Functions ---
    function showStep(stepId) {
        document.querySelectorAll('.view-step').forEach(el => el.classList.remove('active'));
        document.getElementById(stepId).classList.add('active');
    }

    backToStep1Btn.addEventListener('click', () => {
        showStep('step-1');
    });

    backToStep2Btn.addEventListener('click', () => {
        showStep('step-2');
    });


    // --- Generation Logic (Step 1 -> Step 2) ---
    generateBtn.addEventListener('click', async () => {
        const text = userInput.value.trim();
        const format = formatSelect.value;

        if (!text && !imageFiles.length) {
            alert('Please provide keywords or an image.');
            return;
        }

        if (text.length > MAX_TEXT_LENGTH) {
            alert(`Text is too long. Maximum ${MAX_TEXT_LENGTH} characters allowed.`);
            return;
        }

        const currentPayload = {
            userInput: text,
            format: format,
            imageData: imageFiles.length ? imageFiles.map(item => item.base64) : null
        };

        const currentPayloadStr = JSON.stringify(currentPayload);

        // --- TOKEN CACHING LOGIC ---
        // If the payload hasn't changed, skip API calls and just show Step 2
        if (lastPayloadStr === currentPayloadStr) {
            showStep('step-2');
            return;
        }

        // --- NEW GENERATION ---
        lastPayloadStr = currentPayloadStr;
        generatedData = {}; // Clear old data
        documentPreview.innerHTML = '';

        // Go to Step 2
        showStep('step-2');

        // UI Reset
        ['gemini', 'gpt', 'claude'].forEach(ai => {
            const cardBody = document.querySelector(`#card-${ai} .card-body`);
            const selectBtn = document.querySelector(`.select-btn[data-target="${ai}"]`);

            selectBtn.disabled = true;
            cardBody.querySelector('.placeholder-text').style.display = 'none';
            cardBody.querySelector('.markdown-content').style.display = 'none';
            cardBody.querySelector('.loading-spinner').style.display = 'flex';
            cardBody.querySelector('.markdown-content').innerHTML = '';
        });

        // Parallel Fetch Requests
        const apis = [
            { id: 'gemini', url: '/api/generate/gemini' },
            { id: 'gpt', url: '/api/generate/gpt' },
            { id: 'claude', url: '/api/generate/claude' }
        ];

        const fetchPromises = apis.map(api => fetchAPI(api.id, api.url, currentPayload));
        await Promise.allSettled(fetchPromises);
    });

    async function fetchAPI(id, url, payload) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            const cardBody = document.querySelector(`#card-${id} .card-body`);
            cardBody.querySelector('.loading-spinner').style.display = 'none';
            const contentDiv = cardBody.querySelector('.markdown-content');
            contentDiv.style.display = 'block';

            if (data.success) {
                if (data.result.includes('Connection not currently configured')) {
                    contentDiv.innerHTML = `<div class="info-text"><i class="fa-solid fa-circle-info"></i> ${data.result}</div>`;
                } else {
                    // Store raw text
                    generatedData[id] = data.result;

                    // Render HTML for Step 2 (academic paper style)
                    contentDiv.innerHTML = renderAcademicText(data.result);

                    // Enable Select Button
                    document.querySelector(`.select-btn[data-target="${id}"]`).disabled = false;
                }
            } else {
                contentDiv.innerHTML = `<div class="error-text"><i class="fa-solid fa-circle-exclamation"></i> Error: ${data.error || 'Failed to generate'}</div>`;
            }

        } catch (error) {
            console.error(`Error with ${id}:`, error);
            const cardBody = document.querySelector(`#card-${id} .card-body`);
            cardBody.querySelector('.loading-spinner').style.display = 'none';
            const contentDiv = cardBody.querySelector('.markdown-content');
            contentDiv.style.display = 'block';
            contentDiv.innerHTML = `<div class="error-text"><i class="fa-solid fa-circle-exclamation"></i> Connection error. Make sure the server is running.</div>`;
        }
    }

    // --- Select Outline Logic (Step 2 -> Step 3) ---
    selectBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            const markdownText = generatedData[targetId];

            if (markdownText) {
                selectedMarkdown = markdownText;
                downloadWordBtn.disabled = false;
                downloadLatexBtn.disabled = false;
                // Render academic text into Step 3 document preview
                documentPreview.innerHTML = renderAcademicText(markdownText);
                showStep('step-3');
            }
        });
    });

    function downloadFile(filename, content, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function markdownToLatex(markdown) {
        const lines = markdown.split('\n');
        let latexLines = [
            '\\documentclass{article}',
            '\\usepackage[utf8]{inputenc}',
            '\\usepackage{enumitem}',
            '\\begin{document}'
        ];
        let inItemize = false;

        lines.forEach(line => {
            const trimmed = line.trim();
            if (/^#{3}\s+/.test(trimmed)) {
                if (inItemize) { latexLines.push('\\end{itemize}'); inItemize = false; }
                latexLines.push('\\subsubsection{' + trimmed.replace(/^#{3}\s+/, '') + '}');
            } else if (/^#{2}\s+/.test(trimmed)) {
                if (inItemize) { latexLines.push('\\end{itemize}'); inItemize = false; }
                latexLines.push('\\subsection{' + trimmed.replace(/^#{2}\s+/, '') + '}');
            } else if (/^#\s+/.test(trimmed)) {
                if (inItemize) { latexLines.push('\\end{itemize}'); inItemize = false; }
                latexLines.push('\\section{' + trimmed.replace(/^#\s+/, '') + '}');
            } else if (/^[-*+]\s+/.test(trimmed)) {
                if (!inItemize) { latexLines.push('\\begin{itemize}[leftmargin=*]'); inItemize = true; }
                latexLines.push('\\item ' + trimmed.replace(/^[-*+]\s+/, ''));
            } else if (trimmed === '') {
                if (inItemize) { latexLines.push('\\end{itemize}'); inItemize = false; }
                latexLines.push('');
            } else {
                if (inItemize) { latexLines.push('\\end{itemize}'); inItemize = false; }
                let paragraph = trimmed
                    .replace(/\*\*(.*?)\*\*/g, '\\textbf{$1}')
                    .replace(/\*(.*?)\*/g, '\\emph{$1}');
                latexLines.push(paragraph + '\\');
            }
        });

        if (inItemize) {
            latexLines.push('\\end{itemize}');
        }
        latexLines.push('\\end{document}');
        return latexLines.join('\n');
    }

    downloadWordBtn.addEventListener('click', () => {
        if (!selectedMarkdown) {
            alert('Please select an outline before downloading.');
            return;
        }

        const htmlContent = marked.parse(selectedMarkdown);
        const wordHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${htmlContent}</body></html>`;
        downloadFile(`Paper_Outline_${new Date().getTime()}.doc`, wordHtml, 'application/msword;charset=utf-8');
    });

    downloadLatexBtn.addEventListener('click', () => {
        if (!selectedMarkdown) {
            alert('Please select an outline before downloading.');
            return;
        }

        const latexContent = markdownToLatex(selectedMarkdown);
        downloadFile(`Paper_Outline_${new Date().getTime()}.tex`, latexContent, 'text/x-tex;charset=utf-8');
    });

    newProjectBtn.addEventListener('click', () => {
        resetForm();
        showStep('step-1');
    });

});
