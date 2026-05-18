import { useRef, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';

// Dynamically load face-api.js script from a script tag to prevent bundler compilation performance drops
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve(window.faceapi);
    script.onerror = (err) => reject(err);
    document.body.appendChild(script);
  });
};

export default function App() {
  const webcamRef = useRef(null);
  const [faceapi, setFaceapi] = useState(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [dbStudents, setDbStudents] = useState([]);

  // Registration State
  const [regName, setRegName] = useState('');
  const [regId, setRegId] = useState('');

  // Status Tracking States
  const [statusMessage, setStatusMessage] = useState('Initializing application...');
  const [blinkDetected, setBlinkDetected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Constants for Blink Detection
  // NOTE: If it still doesn't trigger, watch the console.log and change this number to match your actual closed-eye number!
  const EAR_THRESHOLD = 0.27;

  useEffect(() => {
    // 1. Load face-api.js from CDN
    loadScript('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.js')
      .then((api) => {
        setFaceapi(api);
        // 2. Load models from public/models folder
        Promise.all([
          api.nets.ssdMobilenetv1.loadFromUri('/models'),
          api.nets.faceLandmark68Net.loadFromUri('/models'),
          api.nets.faceRecognitionNet.loadFromUri('/models')
        ]).then(() => {
          setModelsLoaded(true);
          setStatusMessage('Models loaded. Fetching registered database records...');
          fetchStudents();
        });
      })
      .catch(() => setStatusMessage('Failed to load Face-API scripts.'));
  }, []);

  const fetchStudents = async () => {
    try {
      const res = await axios.get('https://smart-attendence-system-1-y8g4.onrender.com/api/students');
      setDbStudents(res.data);
      setStatusMessage('System Ready. Position your face in front of the camera.');
    } catch (err) {
      setStatusMessage('Error fetching records from backend server.');
    }
  };

  // Utility math function: Euclidean Distance between two landmark points
  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  // Calculate Eye Aspect Ratio (EAR) for dynamic blink assessment
  const calculateEAR = (eyeLandmarks) => {
    const p1 = eyeLandmarks[0];
    const p2 = eyeLandmarks[1];
    const p3 = eyeLandmarks[2];
    const p4 = eyeLandmarks[3];
    const p5 = eyeLandmarks[4];
    const p6 = eyeLandmarks[5];

    const vertical1 = getDistance(p2, p6);
    const vertical2 = getDistance(p3, p5);
    const horizontal = getDistance(p1, p4);

    return (vertical1 + vertical2) / (2.0 * horizontal);
  };

  // Real-time tracking loop (Upgraded for ML performance)
  useEffect(() => {
    if (!modelsLoaded || !faceapi || isProcessing || blinkDetected) return;

    let isMounted = true;

    const detectFrame = async () => {
      if (!isMounted) return;

      if (webcamRef.current && webcamRef.current.video.readyState === 4) {
        const video = webcamRef.current.video;

        // Find single face descriptor with 68 landmark coordinates
        const detection = await faceapi
          .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.7 }))
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (detection) {
          const landmarks = detection.landmarks;
          const leftEye = landmarks.getLeftEye();
          const rightEye = landmarks.getRightEye();

          const leftEAR = calculateEAR(leftEye);
          const rightEAR = calculateEAR(rightEye);
          const averageEAR = (leftEAR + rightEAR) / 2;

          // DEBUGGING: Watch your numbers live in the console!
          console.log("Current EAR:", averageEAR.toFixed(3));

          // Check if user blinked
          if (averageEAR < EAR_THRESHOLD) {
            setBlinkDetected(true);
            setStatusMessage('Liveness verification successful (Blink detected)! Processing verification...');
            handleVerificationAndAttendance(detection.descriptor);
            return; // Exit the loop entirely so it doesn't run again while verifying
          } else {
            setStatusMessage('Face detected. Please BLINK naturally to mark your attendance.');
          }
        } else {
          setStatusMessage('No face detected. Adjust frame positioning or lighting.');
        }
      }

      // ONLY call the next frame AFTER the current one is 100% finished processing
      setTimeout(detectFrame, 100);
    };

    // Start the recursive loop
    detectFrame();

    return () => {
      isMounted = false; // Cleanup when the effect re-runs
    };
  }, [modelsLoaded, faceapi, blinkDetected, dbStudents, isProcessing]);

  // Compare live face vector matrix with DB entries
  const handleVerificationAndAttendance = async (liveDescriptor) => {
    setIsProcessing(true);
    if (dbStudents.length === 0) {
      setStatusMessage('Verification failed: No registered students found in backend database.');
      resetTrackingState();
      return;
    }

    let bestMatch = null;
    let lowestDistance = 1.0; // Max distance threshold is typically 1.0

    dbStudents.forEach(student => {
      // Reconstruct Float32Array out of standard stored number array
      const dbVector = new Float32Array(student.faceDescriptor);
      const distance = faceapi.euclideanDistance(liveDescriptor, dbVector);

      if (distance < lowestDistance) {
        lowestDistance = distance;
        bestMatch = student;
      }
    });

    // 0.6 is the industry-standard match confidence cut-off ceiling for face-api
    if (bestMatch && lowestDistance < 0.6) {
      try {
        setStatusMessage(`Matching match found: ${bestMatch.name}. Saving entry...`);
        const res = await axios.post('https://smart-attendence-system-1-y8g4.onrender.com/api/attendance', { studentId: bestMatch.studentId });
        setStatusMessage(res.data.message || 'Attendance completed successfully.');
      } catch (err) {
        setStatusMessage(err.response?.data?.message || err.response?.data?.error || 'Network logging mismatch.');
      }
    } else {
      setStatusMessage('Access Denied: Unrecognized person variant detected.');
    }

    // Delay reset slightly to let the user read the result status message on screen
    setTimeout(() => {
      resetTrackingState();
    }, 4000);
  };

  const resetTrackingState = () => {
    setBlinkDetected(false);
    setIsProcessing(false);
  };

  // Register Handler
  const handleRegister = async (e) => {
    e.preventDefault();
    if (!regName || !regId) return alert('Fill entry items.');
    if (!webcamRef.current) return alert('Video feed capture down.');

    try {
      setStatusMessage('Capturing high-definition facial embedding coordinates...');
      const video = webcamRef.current.video;
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.8 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        alert('Could not map face layout cleanly. Clear tracking lines or shift lighting frames.');
        return;
      }

      const descriptorArray = Array.from(detection.descriptor);

      await axios.post('https://smart-attendence-system-1-y8g4.onrender.com/api/register', {
        studentId: regId,
        name: regName,
        faceDescriptor: descriptorArray
      });

      alert('Student registration confirmed inside database.');
      setRegId('');
      setRegName('');
      fetchStudents(); // Pull latest changes down
    } catch (err) {
      alert(err.response?.data?.error || 'Registration error.');
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: '900px', margin: '0 auto', padding: '20px' }}>
      <h2 style={{ textAlign: 'center' }}>Smart Attendance System (Blink Liveness Proof)</h2>
      <hr />

      <div style={{ display: 'flex', gap: '30px', marginTop: '20px' }}>
        {/* Left Side: Video Console */}
        <div style={{ flex: 1, textAlign: 'center' }}>
          <h3>Webcam Feed</h3>
          <div style={{ position: 'relative', border: '2px solid #333', borderRadius: '8px', overflow: 'hidden', height: '360px', background: '#000' }}>
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          <div style={{ marginTop: '15px', padding: '12px', background: '#f0f0f0', borderRadius: '6px', fontWeight: 'bold', color: '#222' }}>
            Status: {statusMessage}
          </div>
        </div>

        {/* Right Side: Control Settings & Admin Input */}
        <div style={{ width: '320px' }}>
          <div style={{ padding: '15px', border: '1px solid #ccc', borderRadius: '8px', background: '#fafafa' }}>
            <h3>Register New Profile</h3>
            <form onSubmit={handleRegister}>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', marginBottom: '4px' }}>Student ID:</label>
                <input type="text" value={regId} onChange={(e) => setRegId(e.target.value)} style={{ width: '100%', padding: '6px' }} placeholder="e.g. IS101" />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '4px' }}>Full Name:</label>
                <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)} style={{ width: '100%', padding: '6px' }} placeholder="e.g. Prathviraj Bhure" />
              </div>
              <button type="submit" disabled={!modelsLoaded} style={{ width: '100%', padding: '10px', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                Capture & Save Student
              </button>
            </form>
          </div>

          <div style={{ marginTop: '20px', padding: '15px', border: '1px solid #ccc', borderRadius: '8px', background: '#fafafa' }}>
            <h3>Loaded DB Records ({dbStudents.length})</h3>
            <ul style={{ paddingLeft: '20px', maxHeight: '120px', overflowY: 'auto' }}>
              {dbStudents.map(s => <li key={s.studentId}>{s.name} ({s.studentId})</li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}