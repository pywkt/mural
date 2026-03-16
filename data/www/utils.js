// DOM helpers
export function $(selector) {
    return document.querySelector(selector);
}

export function $$(selector) {
    return document.querySelectorAll(selector);
}

// Throttle — replacement for $.throttle
export function throttle(delay, fn) {
    let lastCall = 0;
    return function (...args) {
        const now = Date.now();
        if (now - lastCall >= delay) {
            lastCall = now;
            return fn.apply(this, args);
        }
    };
}

// AJAX helpers — replacements for $.get, $.post, $.ajax

export async function httpGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.json();
}

export async function httpPost(url, data = {}) {
    const params = new URLSearchParams(data);
    const res = await fetch(url, { method: 'POST', body: params });
    if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
}

// Upload with progress — fetch() doesn't support upload progress, so use XMLHttpRequest
export function httpUpload(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        if (onProgress) {
            xhr.upload.addEventListener('progress', onProgress);
        }
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                let result = xhr.responseText;
                try { result = JSON.parse(result); } catch {}
                resolve(result);
            } else {
                reject(new Error(`Upload failed: ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(formData);
    });
}

// Download with progress — for verification downloads
export function httpDownload(url, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        if (onProgress) {
            xhr.addEventListener('progress', onProgress);
        }
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.responseText);
            } else {
                reject(new Error(`Download failed: ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error('Download failed'));
        xhr.send();
    });
}

// Show/hide helpers
export function show(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (el) el.style.display = '';
}

export function hide(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (el) el.style.display = 'none';
}

export function hideAll(selector) {
    document.querySelectorAll(selector).forEach(el => el.style.display = 'none');
}
