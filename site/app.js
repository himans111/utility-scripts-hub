(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_CONTEXT_MESSAGES = 14;
  const STORAGE_KEY = 'astra_chats_v1';
  const SETTINGS_KEY = 'astra_settings_v1';

  const state = {
    chats: loadChats(),
    currentId: null,
    attachments: [],
    web: false,
    code: false,
    maps: false,
    image: false,
    busy: false,
    recognizing: false,
    recognition: null,
    installPrompt: null,
    searchMode: false,
    settings: loadSettings(),
    toastTimer: null,
  };

  function loadChats() {
    try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  function loadSettings() {
    try { return { theme: 'light', speak: false, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { theme: 'light', speak: false }; }
  }
  function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); }
  function saveChats() {
    state.chats = state.chats.slice(0, 35);
    try { const safeCopy = state.chats.map(chat => ({ ...chat, messages: (chat.messages || []).map(message => ({ ...message, images: [] })) })); localStorage.setItem(STORAGE_KEY, JSON.stringify(safeCopy)); }
    catch { toast('Local storage is full. Delete some old chats.'); }
  }
  function getApiKey() { return sessionStorage.getItem('astra_api_key') || localStorage.getItem('astra_saved_api_key') || ''; }
  function setApiKey(key, remember) {
    sessionStorage.removeItem('astra_api_key');
    localStorage.removeItem('astra_saved_api_key');
    if (key) (remember ? localStorage : sessionStorage).setItem(remember ? 'astra_saved_api_key' : 'astra_api_key', key);
    updateConnectionUI();
  }
  function id() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function currentChat() { return state.chats.find(c => c.id === state.currentId) || null; }
  function newChat() {
    const chat = { id: id(), title: 'New conversation', updated: Date.now(), model: $('#modelSelect').value, messages: [] };
    state.chats.unshift(chat); state.currentId = chat.id; saveChats(); renderAll(); closeMobileSidebar(); $('#promptInput').focus();
  }
  function setCurrentChat(chatId) {
    if (!state.chats.some(c => c.id === chatId)) return;
    state.currentId = chatId; renderAll(); closeMobileSidebar();
  }
  function deleteChat(chatId) {
    state.chats = state.chats.filter(c => c.id !== chatId);
    if (state.currentId === chatId) state.currentId = state.chats[0]?.id || null;
    saveChats(); renderAll();
  }
  function toast(message) {
    const node = $('#toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
  }
  function safeUrl(raw) {
    try { const url = new URL(raw); return ['https:', 'http:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; }
  }
  function renderMarkdown(markdown) {
    const text = String(markdown || '').replace(/\r\n/g, '\n');
    const codeBlocks = [];
    let html = escapeHtml(text).replace(/```([\w+-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const index = codeBlocks.push({ lang: lang || 'code', code }) - 1;
      return `@@CODE${index}@@`;
    });
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    const blocks = html.split(/\n{2,}/).map(block => {
      const trimmed = block.trim(); if (!trimmed) return '';
      if (/^@@CODE\d+@@$/.test(trimmed)) return trimmed;
      if (/^#{1,3}\s/.test(trimmed)) return trimmed.split('\n').map(line => {
        const match = line.match(/^(#{1,3})\s(.*)$/); return match ? `<h${match[1].length}>${match[2]}</h${match[1].length}>` : line;
      }).join('');
      const lines = trimmed.split('\n');
      if (lines.every(line => /^\s*[-*]\s+/.test(line))) return `<ul>${lines.map(line => `<li>${line.replace(/^\s*[-*]\s+/, '')}</li>`).join('')}</ul>`;
      if (lines.every(line => /^\s*\d+[.)]\s+/.test(line))) return `<ol>${lines.map(line => `<li>${line.replace(/^\s*\d+[.)]\s+/, '')}</li>`).join('')}</ol>`;
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    }).join('');
    return blocks.replace(/@@CODE(\d+)@@/g, (_, n) => {
      const block = codeBlocks[Number(n)];
      return `<div class="code-block"><div class="code-head"><span>${escapeHtml(block.lang)}</span><button type="button" data-copy-code="${Number(n)}">Copy code</button></div><pre><code>${block.code}</code></pre></div>`;
    });
  }
  function renderAll() { renderChatList(); renderConversation(); updateConnectionUI(); }
  function renderChatList() {
    const list = $('#chatList'); list.innerHTML = '';
    const chats = state.chats.slice().sort((a,b) => b.updated - a.updated);
    if (!chats.length) { list.innerHTML = '<div class="empty-history">Your conversations will appear here.</div>'; return; }
    for (const chat of chats) {
      const button = document.createElement('button'); button.className = `chat-item${chat.id === state.currentId ? ' active' : ''}`; button.type = 'button';
      button.innerHTML = `<svg><use href="#i-spark"></use></svg><span class="chat-name">${escapeHtml(chat.title || 'New conversation')}</span><span class="chat-delete" role="button" tabindex="0" aria-label="Delete conversation"><svg><use href="#i-trash"></use></svg></span>`;
      button.addEventListener('click', (event) => { if (event.target.closest('.chat-delete')) { event.stopPropagation(); deleteChat(chat.id); } else setCurrentChat(chat.id); });
      list.appendChild(button);
    }
  }
  function renderConversation() {
    const chat = currentChat();
    $('#welcomeScreen').style.display = chat?.messages?.length ? 'none' : 'flex';
    $('#messages').innerHTML = '';
    $('#currentTitle').textContent = chat?.title || 'New conversation';
    if (!chat) return;
    if (chat.model) $('#modelSelect').value = chat.model;
    for (const message of chat.messages) appendMessageToDOM(message, false);
    scrollToBottom();
  }
  function appendMessageToDOM(message, scroll = true) {
    const wrap = $('#messages');
    const node = document.createElement('article'); node.className = `message ${message.role === 'user' ? 'user' : 'ai'}`;
    if (message.role !== 'user') {
      const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.innerHTML = '<svg><use href="#i-spark"></use></svg>'; node.appendChild(avatar);
    }
    const content = document.createElement('div'); content.className = 'message-content';
    const text = document.createElement('div'); text.className = 'message-text';
    if (message.error) {
      const errorBox = document.createElement('div');
      errorBox.className = 'error-box';
      errorBox.innerHTML = renderMarkdown(message.text || 'The request failed. Please try again.');
      text.appendChild(errorBox);
    } else {
      text.innerHTML = renderMarkdown(message.text || '');
    }
    content.appendChild(text);
    for (const img of (message.images || [])) {
      const image = document.createElement('img'); image.className = 'message-image'; image.src = img.dataUrl; image.alt = img.alt || 'Generated image'; content.appendChild(image);
    }
    if (message.sources?.length) {
      const sources = document.createElement('div'); sources.className = 'source-list';
      message.sources.forEach((source, index) => {
        const a = document.createElement('a'); a.className = 'source-link'; a.href = safeUrl(source.url); a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.innerHTML = `<span class="source-number">${index + 1}</span><span>${escapeHtml(source.title || new URL(a.href).hostname)}</span> ↗`; sources.appendChild(a);
      }); content.appendChild(sources);
    }
    if (message.role !== 'user' && !message.pending && message.text) {
      const actions = document.createElement('div'); actions.className = 'message-actions';
      actions.innerHTML = '<button type="button" data-action="copy"><svg><use href="#i-copy"></use></svg>Copy</button><button type="button" data-action="speak"><svg><use href="#i-volume"></use></svg>Listen</button>';
      actions.querySelector('[data-action="copy"]').addEventListener('click', () => copyText(message.text));
      actions.querySelector('[data-action="speak"]').addEventListener('click', () => speak(message.text));
      content.appendChild(actions);
    }
    node.appendChild(content); wrap.appendChild(node);
    text.querySelectorAll('[data-copy-code]').forEach(button => button.addEventListener('click', () => {
      const code = button.closest('.code-block')?.querySelector('pre code')?.textContent || '';
      copyText(code);
    }));
    if (scroll) scrollToBottom();
    return node;
  }
  function scrollToBottom() { const pane = $('#conversationWrap'); requestAnimationFrame(() => pane.scrollTop = pane.scrollHeight); }
  function closeMobileSidebar() { $('#sidebar').classList.remove('open'); $('#sidebarScrim').classList.remove('open'); }
  function toggleTool(button, key) { state[key] = !state[key]; button.setAttribute('aria-pressed', String(state[key])); }
  function updateConnectionUI() {
    const connected = Boolean(getApiKey());
    const badge = $('#connectionBadge');
    if (badge) { badge.textContent = connected ? 'Key saved' : 'Not connected'; badge.classList.toggle('connected', connected); }
    const notice = $('#apiNotice'); if (notice) notice.style.display = connected ? 'none' : 'flex';
  }
  function openSettings() {
    $('#settingsModal').classList.add('open'); $('#settingsModal').setAttribute('aria-hidden','false');
    $('#apiKeyInput').value = getApiKey(); $('#rememberKey').checked = Boolean(localStorage.getItem('astra_saved_api_key'));
    $('#speakToggle').checked = Boolean(state.settings.speak); updateConnectionUI();
  }
  function closeSettings() { $('#settingsModal').classList.remove('open'); $('#settingsModal').setAttribute('aria-hidden','true'); }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => {
        const result = String(reader.result || ''); resolve(result.slice(result.indexOf(',') + 1));
      }; reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
  }
  async function handleFiles(files) {
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) { toast(`${file.name}: choose a file under 15 MB.`); continue; }
      const lower = file.name.toLowerCase();
      if (file.type.startsWith('image/')) {
        const data = await fileToBase64(file); const dataUrl = `data:${file.type};base64,${data}`;
        state.attachments.push({ name:file.name, kind:'image', data, mime:file.type, preview:dataUrl });
      } else if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
        state.attachments.push({ name:file.name, kind:'document', data:await fileToBase64(file), mime:'application/pdf' });
      } else if (file.type.startsWith('audio/')) {
        state.attachments.push({ name:file.name, kind:'audio', data:await fileToBase64(file), mime:file.type });
      } else if (file.type.startsWith('text/') || file.type === 'text/csv' || lower.endsWith('.csv') || lower.endsWith('.txt')) {
        state.attachments.push({ name:file.name, kind:'text', text:await file.text(), mime:'text/plain' });
      } else {
        toast(`${file.name}: use PDF, image, audio, TXT or CSV.`);
      }
    }
    renderAttachments(); $('#fileInput').value = '';
  }
  function renderAttachments() {
    const strip = $('#attachmentStrip'); strip.innerHTML = '';
    strip.style.display = state.attachments.length ? 'flex' : 'none';
    state.attachments.forEach((file, index) => {
      const chip = document.createElement('div'); chip.className = 'attachment-chip';
      if (file.preview) { const img = document.createElement('img'); img.src = file.preview; img.alt=''; chip.appendChild(img); }
      else { const icon = document.createElement('span'); icon.textContent = file.kind === 'document' ? 'PDF' : file.kind === 'audio' ? '♪' : 'TXT'; chip.appendChild(icon); }
      const name = document.createElement('span'); name.textContent = file.name; chip.appendChild(name);
      const remove = document.createElement('button'); remove.type='button'; remove.innerHTML='<svg><use href="#i-close"></use></svg>'; remove.setAttribute('aria-label','Remove file'); remove.addEventListener('click', () => { state.attachments.splice(index,1); renderAttachments(); }); chip.appendChild(remove); strip.appendChild(chip);
    });
  }
  function autoResizeInput() { const input = $('#promptInput'); input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight,170)}px`; }
  function newAssistantTyping() {
    const node = document.createElement('article'); node.className='message ai'; node.id='typingMessage';
    node.innerHTML='<div class="message-avatar"><svg><use href="#i-spark"></use></svg></div><div class="message-content"><div class="typing-indicator"><span></span><span></span><span></span></div></div>';
    $('#messages').appendChild(node); scrollToBottom(); return node;
  }
  function getResponseData(response) {
    const result = { text:'', images:[], sources:[] };
    const steps = Array.isArray(response?.steps) ? response.steps : [];
    for (const step of steps) {
      if (step.type !== 'model_output') continue;
      for (const block of (step.content || [])) {
        if (block.type === 'text' && typeof block.text === 'string') {
          result.text += (result.text ? '\n' : '') + block.text;
          for (const annotation of (block.annotations || [])) {
            if (annotation.type === 'url_citation' && (annotation.url || annotation.uri)) {
              const url = annotation.url || annotation.uri;
              if (!result.sources.some(source => source.url === url)) {
                result.sources.push({ url, title: annotation.title || '' });
              }
            }
          }
        } else if (block.type === 'image' && block.data) {
          result.images.push({
            dataUrl: `data:${block.mime_type || 'image/png'};base64,${block.data}`,
            alt: 'Image generated by Astra'
          });
        }
      }
    }

    // Keep compatibility with SDK-style and future response shapes.
    if (!result.text && typeof response?.output_text === 'string') {
      result.text = response.output_text;
    }
    if (!result.text && Array.isArray(response?.outputs)) {
      for (const output of response.outputs) {
        if (output.type === 'text' && typeof output.text === 'string') {
          result.text += (result.text ? '\n' : '') + output.text;
        }
      }
    }
    return result;
  }
  function makeInput(prompt, attachments, chat, isImage) {
    const history = (chat?.messages || []).slice(0, -1).filter(m => !m.pending).slice(-MAX_CONTEXT_MESSAGES).map(m => `${m.role === 'user' ? 'User' : 'Astra'}: ${m.text}`).join('\n\n');
    const modeInstruction = isImage
      ? 'Create a polished, high-quality image from the latest user request. Return an image, not merely a description.'
      : 'You are Astra AI, a capable, warm, careful multilingual assistant. Reply in the language used by the user unless asked otherwise. Be accurate, structured, useful, and direct. For study questions, explain clearly with examples. Do not invent sources or claim you performed actions you did not perform.';
    const combined = `${modeInstruction}\n\n${history ? `Conversation context (older turns):\n${history}\n\n` : ''}User's latest message:\n${prompt || (attachments.length ? 'Please inspect the attached file(s) and explain what matters.' : '')}`;
    const input = [{ type:'text', text:combined }];
    const videoMatch = prompt.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+)/i);
    if (videoMatch) input.push({ type:'video', uri:videoMatch[0] });
    for (const file of attachments) {
      if (file.kind === 'image') input.push({ type:'image', data:file.data, mime_type:file.mime });
      else if (file.kind === 'document') input.push({ type:'document', data:file.data, mime_type:file.mime });
      else if (file.kind === 'audio') input.push({ type:'audio', data:file.data, mime_type:file.mime });
      else if (file.kind === 'text') input.push({ type:'text', text:`\n\nAttached text file: ${file.name}\n${file.text}` });
    }
    return input;
  }
  const MODEL_FALLBACKS = [
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite'
  ];

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function requestWithModelFallback(payload, key, allowFallback = true) {
    const requestedModel = payload.model;
    const models = allowFallback
      ? [requestedModel, ...MODEL_FALLBACKS.filter(model => model !== requestedModel)]
      : [requestedModel];
    const overloadedModels = [];

    for (const model of models) {
      // A short retry helps with a brief capacity spike before switching models.
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 90000);
        let response;

        try {
          response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({ ...payload, model }),
            signal: controller.signal
          });
        } catch (error) {
          if (error?.name === 'AbortError') {
            throw new Error(`Gemini did not respond within 90 seconds while trying ${model}. Please try again.`);
          }
          throw new Error('The app could not reach Google Gemini. Check your internet connection. Details: ' + (error?.message || 'Network error'));
        } finally {
          clearTimeout(timeoutId);
        }

        const raw = await response.text();
        let data;
        try { data = JSON.parse(raw); } catch { data = { message: raw }; }

        if (response.ok) {
          return { data, modelUsed: model, usedFallback: model !== requestedModel };
        }

        const detail = data.error?.message || data.message || `HTTP ${response.status}`;
        if (response.status === 503) {
          overloadedModels.push(model);
          if (attempt === 0) {
            await wait(1000);
            continue;
          }
          break;
        }

        if (response.status === 401 || response.status === 403) {
          throw new Error(`Google rejected this API key or its access. Check the key and Gemini API access. Details: ${detail}`);
        }
        if (response.status === 429) {
          throw new Error(`Gemini quota or rate limit reached. Model switching cannot fix a project quota limit. Check Google AI Studio usage. Details: ${detail}`);
        }
        throw new Error(`Google Gemini returned HTTP ${response.status} for ${model}: ${detail}`);
      }
    }

    throw new Error(
      `Google Gemini is temporarily overloaded (HTTP 503). Astra retried and checked these models: ${[...new Set(overloadedModels)].join(', ')}. No available model responded just now. Your API key format is not the cause. Please try again shortly.`
    );
  }

  async function callGemini(prompt, chat, attachments, isImage) {
    const key = getApiKey();
    if (!key) {
      openSettings();
      throw new Error('Add your Gemini API key in Settings to start chatting.');
    }

    const model = isImage ? 'gemini-nano-banana-2.1' : ($('#modelSelect').value || 'gemini-3.8-flash');
    const tools = [];
    if (state.web && !isImage) tools.push({ type:'google_search' });
    if (state.code && !isImage) tools.push({ type:'code_execution' });
    if (state.maps && !isImage) tools.push({ type:'google_maps' });
    if (state.web && !isImage && /https?:\/\//i.test(prompt)) tools.push({ type:'url_context' });

    const payload = {
      model,
      input: makeInput(prompt, attachments, chat, isImage),
      store: false
    };
    if (tools.length) payload.tools = tools;

    const { data, modelUsed, usedFallback } = await requestWithModelFallback(payload, key, !isImage);
    const result = getResponseData(data);

    if (!result.text && !result.images.length) {
      const apiStatus = data.status || 'unknown';
      const interactionId = data.id ? ` (interaction ${data.id})` : '';
      throw new Error(`Google accepted the request but returned no displayable answer. Status: ${apiStatus}${interactionId}. Try another model or use Test connection in Settings.`);
    }

    result.modelUsed = modelUsed;
    result.usedFallback = usedFallback;
    return result;
  }
  function updateChatTitle(chat, firstMessage) {
    if (chat.title === 'New conversation') {
      const clean = firstMessage.trim().replace(/\s+/g,' ');
      chat.title = clean.length > 34 ? `${clean.slice(0,34)}…` : (clean || 'New conversation');
    }
  }
  async function sendMessage(optionalPrompt = null) {
    if (state.busy) return;
    const input = $('#promptInput'); const prompt = (optionalPrompt ?? input.value).trim();
    if (!prompt && !state.attachments.length) return;
    if (!getApiKey()) { openSettings(); toast('Add your Gemini API key to start.'); return; }
    if (!currentChat()) {
      const chat = { id:id(), title:'New conversation', updated:Date.now(), model:$('#modelSelect').value, messages:[] };
      state.chats.unshift(chat); state.currentId = chat.id;
    }
    const chat = currentChat(); const attachments = state.attachments.slice(); const isImage = state.image;
    const userText = prompt || `Please analyse ${attachments.map(f => f.name).join(', ')}`;
    const attachmentLabel = attachments.length ? `\n\n📎 ${attachments.map(f => f.name).join(', ')}` : '';
    const userMessage = { role:'user', text:userText + attachmentLabel };
    chat.messages.push(userMessage); updateChatTitle(chat, userText); chat.updated = Date.now();
    input.value=''; autoResizeInput(); state.attachments=[]; renderAttachments();
    $('#welcomeScreen').style.display='none'; appendMessageToDOM(userMessage); renderChatList(); $('#currentTitle').textContent=chat.title;
    state.busy=true; $('#sendButton').disabled=true; $('#sendButton').innerHTML='<span class="spinner"></span>';
    const typing = newAssistantTyping();
    try {
      const result = await callGemini(prompt, chat, attachments, isImage);
      typing.remove();
      if (result.usedFallback && result.modelUsed) {
        $('#modelSelect').value = result.modelUsed;
        chat.model = result.modelUsed;
        toast(`The selected model was busy. Astra switched to ${result.modelUsed} automatically.`);
      }
      const assistantMessage = { role:'assistant', text:result.text, images:result.images, sources:result.sources, model:result.modelUsed || (isImage?'gemini-nano-banana-2.1':$('#modelSelect').value) };
      chat.messages.push(assistantMessage); chat.updated=Date.now(); saveChats(); appendMessageToDOM(assistantMessage); renderChatList();
      if (state.settings.speak && result.text) speak(result.text);
    } catch (error) {
      typing.remove();
      const failMessage = { role:'assistant', text:`I couldn't complete that request.\n\n${error.message}`, error:true };
      chat.messages.push(failMessage); chat.updated=Date.now(); saveChats(); appendMessageToDOM(failMessage);
      toast(error.message.length > 90 ? 'Request failed. See the message for details.' : error.message);
    } finally {
      state.busy=false; $('#sendButton').disabled=false; $('#sendButton').innerHTML='<svg><use href="#i-send"></use></svg>';
      state.image=false; $('#imageToggle').setAttribute('aria-pressed','false');
      saveChats(); scrollToBottom();
    }
  }
  function copyText(text) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard.')).catch(() => fallbackCopy(text));
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const textarea=document.createElement('textarea'); textarea.value=text; document.body.appendChild(textarea); textarea.select();
    try { document.execCommand('copy'); toast('Copied to clipboard.'); } catch { toast('Could not copy this text.'); }
    textarea.remove();
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) { toast('Text-to-speech is not supported in this browser.'); return; }
    window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g,'Code block omitted.'));
    utterance.lang = /[\u0900-\u097F]/.test(text) ? 'hi-IN' : 'en-IN'; utterance.rate=1; window.speechSynthesis.speak(utterance);
  }
  function toggleMic() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { toast('Voice typing works best in Chrome on Android.'); return; }
    if (state.recognizing) { state.recognition?.stop(); return; }
    const recognition = new Recognition(); state.recognition=recognition; recognition.lang='hi-IN'; recognition.interimResults=true; recognition.continuous=false;
    const button=$('#micButton'); state.recognizing=true; button.classList.add('recording');
    recognition.onresult = event => {
      let transcript=''; for (let i=event.resultIndex;i<event.results.length;i++) transcript += event.results[i][0].transcript;
      $('#promptInput').value=transcript; autoResizeInput();
    };
    recognition.onerror = () => toast('Microphone input stopped. Check browser permission.');
    recognition.onend = () => { state.recognizing=false; button.classList.remove('recording'); $('#promptInput').focus(); };
    try { recognition.start(); toast('Listening… speak now.'); } catch { state.recognizing=false; button.classList.remove('recording'); }
  }
  async function testConnection() {
    const key = $('#apiKeyInput').value.trim() || getApiKey();
    if (!key) { toast('Paste your Gemini API key first.'); return; }
    const requestedModel = $('#modelSelect').value || 'gemini-3.8-flash';
    const button = $('#testKey');
    const oldLabel = button.textContent;
    button.textContent = 'Testing…';
    button.disabled = true;
    try {
      const { data, modelUsed, usedFallback } = await requestWithModelFallback({
        model: requestedModel,
        input: 'Reply with exactly: Astra is connected.',
        store: false
      }, key, true);

      const result = getResponseData(data);
      if (!result.text) {
        throw new Error(`The API responded but did not return a text answer. Status: ${data.status || 'unknown'}. Model: ${modelUsed}.`);
      }

      if (usedFallback) {
        $('#modelSelect').value = modelUsed;
        const chat = currentChat();
        if (chat) { chat.model = modelUsed; saveChats(); }
        toast(`Connection works. ${requestedModel} was busy; switched to ${modelUsed}. Reply: ${result.text.slice(0, 50)}`);
      } else {
        toast(`Connection works — ${modelUsed} replied: ${result.text.slice(0, 65)}`);
      }
    } catch (error) {
      toast(`Connection test failed: ${error.message || 'Network error'}`);
    } finally {
      button.textContent = oldLabel;
      button.disabled = false;
    }
  }
  function saveKey() {
    const key=$('#apiKeyInput').value.trim(); if (!key) { toast('Paste a Gemini API key first.'); return; }
    setApiKey(key,$('#rememberKey').checked); toast('API key saved in this browser.'); closeSettings();
  }
  function clearAllChats() {
    if (!state.chats.length) { toast('There are no saved chats.'); return; }
    if (!confirm('Delete all conversations stored in this browser?')) return;
    state.chats=[]; state.currentId=null; saveChats(); renderAll(); toast('Local chat history deleted.');
  }
  function bindEvents() {
    $('#newChat').addEventListener('click',newChat);
    $('#openSettings').addEventListener('click',openSettings); $('#settingsButton').addEventListener('click',openSettings); $('#connectKey').addEventListener('click',openSettings);
    $('#closeSettings').addEventListener('click',closeSettings); $('#settingsModal').addEventListener('click',e=>{if(e.target===$('#settingsModal'))closeSettings();});
    $('#saveKey').addEventListener('click',saveKey); $('#testKey').addEventListener('click',testConnection);
    $('#forgetKey').addEventListener('click',()=>{setApiKey('',false);$('#apiKeyInput').value='';$('#rememberKey').checked=false;toast('Key forgotten in this browser.');});
    $('#toggleKeyVisibility').addEventListener('click',()=>{const input=$('#apiKeyInput');const show=input.type==='password';input.type=show?'text':'password';$('#toggleKeyVisibility').textContent=show?'Hide':'Show';});
    $('#speakToggle').addEventListener('change',e=>{state.settings.speak=e.target.checked;saveSettings();});
    $('#deleteLocalData').addEventListener('click',clearAllChats); $('#clearHistory').addEventListener('click',clearAllChats);
    $('#themeToggle').addEventListener('click',()=>{state.settings.theme=state.settings.theme==='dark'?'light':'dark';applyTheme();saveSettings();});
    $('#webToggle').addEventListener('click',()=>toggleTool($('#webToggle'),'web'));
    $('#codeToggle').addEventListener('click',()=>toggleTool($('#codeToggle'),'code'));
    $('#mapsToggle').addEventListener('click',()=>toggleTool($('#mapsToggle'),'maps'));
    $('#imageToggle').addEventListener('click',()=>{state.image=!state.image;$('#imageToggle').setAttribute('aria-pressed',String(state.image));if(state.image)toast('Image mode: describe the image you want to create.');});
    $('#attachButton').addEventListener('click',()=>$('#fileInput').click());
    $('#fileInput').addEventListener('change',e=>handleFiles([...e.target.files]));
    $('#promptInput').addEventListener('input',autoResizeInput);
    $('#promptInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}});
    $('#sendButton').addEventListener('click',()=>sendMessage());
    $('#micButton').addEventListener('click',toggleMic);
    $$('.suggestion-card').forEach(button=>button.addEventListener('click',()=>{$('#promptInput').value=button.dataset.prompt;autoResizeInput();$('#promptInput').focus();}));
    $('#openSidebar').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#sidebarScrim').classList.add('open');});
    $('#closeSidebar').addEventListener('click',closeMobileSidebar); $('#sidebarScrim').addEventListener('click',closeMobileSidebar);
    $('#searchChats').addEventListener('click',()=>{const q=prompt('Search your conversations:');if(q===null)return;const item=state.chats.find(c=>c.title.toLowerCase().includes(q.toLowerCase())||c.messages.some(m=>m.text.toLowerCase().includes(q.toLowerCase())));if(item)setCurrentChat(item.id);else toast('No matching conversation found.');});
    $('#modelSelect').addEventListener('change',()=>{const chat=currentChat();if(chat){chat.model=$('#modelSelect').value;saveChats();}});
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();newChat();}if(e.key==='Escape'){closeSettings();closeMobileSidebar();}});
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;$('#installButton').style.display='grid';});
    $('#installButton').addEventListener('click',async()=>{if(!state.installPrompt){toast('Use your browser menu → Add to Home screen.');return;}state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;});
  }
  function applyTheme() {
    document.body.classList.toggle('dark',state.settings.theme==='dark');
    $('#themeToggle').innerHTML=state.settings.theme==='dark'?'<svg><use href="#i-sun"></use></svg>':'<svg><use href="#i-moon"></use></svg>';
    document.querySelector('meta[name="theme-color"]').content=state.settings.theme==='dark'?'#17181b':'#f6f5f2';
  }
  let updateRegistration = null;
  let updateReloading = false;

  function setUpdateButton(ready, label) {
    const button = $('#updateButton');
    if (!button) return;
    button.classList.toggle('is-ready', Boolean(ready));
    button.setAttribute('aria-label', label || (ready ? 'Install update' : 'Check for updates'));
    button.title = label || (ready ? 'Install available update' : 'Check for updates');
    const text = button.querySelector('span');
    if (text) text.textContent = label || (ready ? 'Update now' : 'Check updates');
  }

  function applyWaitingUpdate() {
    if (!updateRegistration?.waiting) return false;
    updateReloading = true;
    toast('Installing Astra update…');
    updateRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }

  async function checkForUpdates() {
    const button = $('#updateButton');
    if (!button) return;
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) {
      toast('Updates are available when Astra is installed from its HTTPS website.');
      return;
    }
    button.disabled = true;
    setUpdateButton(false, 'Checking…');
    // In the Android wrapper, this also checks GitHub Releases for a new APK.
    try { window.AstraAndroid?.checkForAppUpdate?.(); } catch (_) { /* Browser/PWA only. */ }
    try {
      updateRegistration = updateRegistration || await navigator.serviceWorker.getRegistration('./') || await navigator.serviceWorker.register('./sw.js');
      if (updateRegistration.waiting && navigator.serviceWorker.controller) {
        applyWaitingUpdate();
        return;
      }
      let foundWorker = null;
      const onFound = () => {
        foundWorker = updateRegistration.installing;
      };
      updateRegistration.addEventListener('updatefound', onFound, { once: true });
      await updateRegistration.update();
      foundWorker = foundWorker || updateRegistration.installing;
      if (foundWorker && navigator.serviceWorker.controller) {
        await new Promise(resolve => {
          if (foundWorker.state === 'installed' || foundWorker.state === 'redundant') return resolve();
          const done = () => { if (foundWorker.state === 'installed' || foundWorker.state === 'redundant') resolve(); };
          foundWorker.addEventListener('statechange', done);
          window.setTimeout(resolve, 9000);
        });
      }
      if (updateRegistration.waiting && navigator.serviceWorker.controller) {
        setUpdateButton(true);
        applyWaitingUpdate();
      } else {
        setUpdateButton(false);
        toast('Astra AI is already up to date.');
      }
    } catch (error) {
      setUpdateButton(false);
      toast(`Could not check updates: ${error.message || 'Please try again.'}`);
    } finally {
      if (!updateReloading) button.disabled = false;
    }
  }

  function setupUpdates() {
    if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateReloading) location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then(registration => {
      updateRegistration = registration;
      if (registration.waiting && navigator.serviceWorker.controller) setUpdateButton(true);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setUpdateButton(true, 'Update now');
        });
      });
      registration.update().catch(() => {});
    }).catch(() => {});
    $('#updateButton')?.addEventListener('click', checkForUpdates);
  }

  function init() {
    applyTheme(); bindEvents();
    if (state.chats.length) { state.currentId=state.chats[0].id; const chat=currentChat(); if(chat?.model) $('#modelSelect').value=chat.model; }
    renderAll(); renderAttachments(); updateConnectionUI();
    setupUpdates();
  }
  init();
})();
