// Presence ERP - Face Attendance Web Dashboard JS

let isWebcamActive = false;
let webcamStream = null;
let recognitionInterval = null;
let capturedBlobs = [];

// ── Tab Navigation ──────────────────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

  document.getElementById(`tab-${tabId}`).classList.add('active');
  event.target.classList.add('active');

  if (tabId === 'employees') {
    loadEmployees();
  } else if (tabId === 'attendance') {
    document.getElementById('reportDatePicker').valueAsDate = new Date();
    loadDailyReport();
  } else if (tabId === 'enrollment') {
    startEnrollmentWebcam();
  }
}

// ── Health Check Poller ─────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const res = await fetch('/health');
    const data = await res.json();
    const badge = document.getElementById('healthBadge');
    const text = document.getElementById('healthText');

    if (data.status === 'healthy') {
      badge.className = 'health-badge';
      text.innerText = 'System Healthy';
    } else {
      badge.className = 'health-badge badge-warning';
      text.innerText = `Status: ${data.status}`;
    }
  } catch (err) {
    const badge = document.getElementById('healthBadge');
    const text = document.getElementById('healthText');
    badge.className = 'health-badge badge-warning';
    text.innerText = 'Offline';
  }
}
setInterval(checkHealth, 5000);
checkHealth();

// ── Live Monitor Webcam Stream ──────────────────────────────────────────────
async function toggleWebcam() {
  const btn = document.getElementById('startCamBtn');
  const video = document.getElementById('liveVideo');

  if (!isWebcamActive) {
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      video.srcObject = webcamStream;
      isWebcamActive = true;
      btn.innerText = 'Stop Webcam';
      btn.classList.add('btn-danger');

      // Start recognition frame loop every 300ms (~3 fps recognition)
      recognitionInterval = setInterval(sendFrameForRecognition, 300);
    } catch (err) {
      alert('Could not access webcam: ' + err.message);
    }
  } else {
    stopWebcam();
  }
}

function stopWebcam() {
  const btn = document.getElementById('startCamBtn');
  const video = document.getElementById('liveVideo');
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
  }
  if (recognitionInterval) {
    clearInterval(recognitionInterval);
  }
  video.srcObject = null;
  isWebcamActive = false;
  btn.innerText = 'Start Webcam';
  btn.classList.remove('btn-danger');

  const canvas = document.getElementById('overlayCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

async function sendFrameForRecognition() {
  const video = document.getElementById('liveVideo');
  const canvas = document.getElementById('overlayCanvas');
  if (!video.videoWidth) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');

  // Draw current frame to hidden offscreen canvas to turn into blob
  const offscreen = document.createElement('canvas');
  offscreen.width = video.videoWidth;
  offscreen.height = video.videoHeight;
  const offCtx = offscreen.getContext('2d');
  offCtx.drawImage(video, 0, 0);

  offscreen.toBlob(async (blob) => {
    if (!blob) return;

    const formData = new FormData();
    formData.append('image', blob, 'frame.jpg');

    const cameraId = document.getElementById('cameraIdInput').value || 'CAM_LOBBY';

    try {
      const res = await fetch(`/recognize?camera_id=${encodeURIComponent(cameraId)}&record_attendance=true`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) return;

      const data = await res.json();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Log results in table
      const logBody = document.getElementById('recognitionLogBody');
      if (logBody.children[0]?.children.length === 1) logBody.innerHTML = '';

      data.results.forEach(r => {
        const timeStr = new Date().toLocaleTimeString();
        const row = document.createElement('tr');
        const isMatch = r.is_match;
        const statusBadge = isMatch 
          ? `<span class="badge badge-success">Match</span>` 
          : `<span class="badge badge-warning">${r.rejection_reason || 'Unknown'}</span>`;

        row.innerHTML = `
          <td>${timeStr}</td>
          <td><strong>${r.employee_name || 'Unknown Face'}</strong></td>
          <td>${r.similarity_score.toFixed(3)}</td>
          <td>${statusBadge}</td>
        `;

        logBody.insertBefore(row, logBody.firstChild);
        if (logBody.children.length > 20) logBody.removeChild(logBody.lastChild);
      });

    } catch (err) {
      console.error('Recognition error:', err);
    }
  }, 'image/jpeg', 0.85);
}

// ── Enrollment Webcam & Capture ─────────────────────────────────────────────
async function startEnrollmentWebcam() {
  const video = document.getElementById('enrollVideo');
  if (video.srcObject) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    video.srcObject = stream;
  } catch (err) {
    console.error('Enrollment webcam error:', err);
  }
}

function captureSample() {
  const video = document.getElementById('enrollVideo');
  if (!video.videoWidth) {
    alert('Webcam is not active.');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  canvas.toBlob(blob => {
    capturedBlobs.push(blob);
    document.getElementById('sampleCount').innerText = capturedBlobs.length;

    const gallery = document.getElementById('captureGallery');
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.className = 'capture-thumb';
    gallery.appendChild(img);

    if (capturedBlobs.length >= 3) {
      document.getElementById('submitEnrollBtn').disabled = false;
    }
  }, 'image/jpeg', 0.9);
}

async function handleEnrollment(event) {
  event.preventDefault();
  const empId = document.getElementById('empId').value.trim();
  const empName = document.getElementById('empName').value.trim();
  const empDept = document.getElementById('empDept').value.trim();
  const statusDiv = document.getElementById('enrollStatus');

  if (capturedBlobs.length < 3) {
    alert('Please capture at least 3 face samples.');
    return;
  }

  statusDiv.innerHTML = '<span style="color:var(--primary-accent);">Submitting enrollment...</span>';

  const formData = new FormData();
  formData.append('employee_id', empId);
  formData.append('name', empName);
  if (empDept) formData.append('department', empDept);

  capturedBlobs.forEach((blob, idx) => {
    formData.append('images', blob, `sample_${idx}.jpg`);
  });

  try {
    const res = await fetch('/employees/enroll', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();
    if (data.success) {
      statusDiv.innerHTML = `<span style="color:var(--success); font-weight:600;">✓ ${data.message}</span>`;
      // Reset form
      document.getElementById('enrollForm').reset();
      capturedBlobs = [];
      document.getElementById('sampleCount').innerText = '0';
      document.getElementById('captureGallery').innerHTML = '';
      document.getElementById('submitEnrollBtn').disabled = true;
    } else {
      statusDiv.innerHTML = `<span style="color:var(--danger); font-weight:600;">✗ ${data.message}</span>`;
    }
  } catch (err) {
    statusDiv.innerHTML = `<span style="color:var(--danger);">Error: ${err.message}</span>`;
  }
}

// ── Directory & Reports ─────────────────────────────────────────────────────
async function loadEmployees() {
  const tbody = document.getElementById('employeeTableBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Loading directory...</td></tr>';

  try {
    const res = await fetch('/employees/');
    const data = await res.json();
    if (data.employees.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No enrolled employees yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    data.employees.forEach(emp => {
      const row = document.createElement('tr');
      const dateStr = new Date(emp.enrolled_at).toLocaleDateString();
      row.innerHTML = `
        <td><strong>${emp.id}</strong></td>
        <td>${emp.name}</td>
        <td>${emp.department || '-'}</td>
        <td>${dateStr}</td>
        <td><span class="badge badge-success">Active</span></td>
        <td><button class="btn btn-secondary" style="padding:0.3rem 0.6rem; font-size:0.8rem;" onclick="deactivateEmployee('${emp.id}')">Deactivate</button></td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--danger); text-align:center;">Error: ${err.message}</td></tr>`;
  }
}

async function deactivateEmployee(id) {
  if (!confirm(`Deactivate employee ${id}? Attendance audit trail will be preserved.`)) return;

  try {
    const res = await fetch(`/employees/${id}/deactivate`, { method: 'PUT' });
    if (res.ok) {
      loadEmployees();
    } else {
      alert('Deactivation failed.');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function loadDailyReport() {
  const dateVal = document.getElementById('reportDatePicker').value;
  if (!dateVal) return;

  const tbody = document.getElementById('attendanceReportBody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading daily report...</td></tr>';

  try {
    const res = await fetch(`/attendance/report/daily?date=${dateVal}`);
    const data = await res.json();

    if (data.entries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No attendance events recorded on ${dateVal}.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    data.entries.forEach(entry => {
      const row = document.createElement('tr');
      const inStr = entry.check_in ? new Date(entry.check_in).toLocaleTimeString() : '-';
      const outStr = entry.check_out ? new Date(entry.check_out).toLocaleTimeString() : '-';

      row.innerHTML = `
        <td><strong>${entry.employee_id}</strong></td>
        <td>${entry.employee_name}</td>
        <td><span style="color:var(--success); font-weight:600;">${inStr}</span></td>
        <td><span style="color:var(--primary-accent); font-weight:600;">${outStr}</span></td>
        <td>${entry.total_events}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--danger); text-align:center;">Error: ${err.message}</td></tr>`;
  }
}
